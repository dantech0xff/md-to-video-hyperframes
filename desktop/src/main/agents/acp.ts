/**
 * ACP client: one agent process (Claude Code or Codex through their adapters,
 * Devin directly), its sessions, and each prompt turn as a stream of events
 * the Agent Hub turns into the activity log.
 *
 * Turn protocol: session/prompt → session/update notifications (messages,
 * thoughts, tool calls, plans) and session/request_permission requests →
 * the prompt response with a stop reason. Cancelling sends session/cancel
 * and answers every pending permission request with "cancelled".
 *
 * A session stays in the permission modes its Launch allows: one that opens
 * in another mode, or switches to one, is set back (session/set_mode).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { PermissionOption } from "../../shared/types";

export interface Launch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** the agent's own settings for every session it opens (ACP _meta) */
  sessionMeta?: Record<string, unknown>;
  /** the permission modes its sessions are kept in */
  mode?: ModeRule;
}

/**
 * Modes in which the agent leaves its decisions to the app: `allowed` (the
 * agent may switch between them, into its read-only plan mode say), and
 * `start`, which a session in any other mode is set to.
 */
export interface ModeRule {
  start: string;
  allowed: readonly string[];
}

export type ToolStatus = "pending" | "running" | "done" | "failed";

export interface PermissionRequest {
  toolCallId: string;
  title: string;
  /** ACP tool kind: read, edit, execute, fetch, other… */
  kind?: string;
  /** the agent's own tool name, when it says (Claude: "Bash", "mcp__getframes__check_layout") */
  tool?: string;
  /**
   * The MCP tool the request is for, when the agent says: its server and name,
   * and whether that server is one the app passed in session/new (not one of
   * the same name from the user's own configuration).
   */
  mcp?: { server: string; tool: string; fromApp: boolean };
  /** paths the tool touches */
  paths: string[];
  rawInput?: unknown;
  /** why the agent asks, in its own words (Codex's justification for a command) */
  reason?: string;
  options: PermissionOption[];
}

export type EndReason = "done" | "cancelled" | "error" | "refusal" | "limit";

export type AgentEvent =
  | { type: "message" | "thought"; text: string; messageId?: string }
  | { type: "tool"; id: string; title?: string; status?: ToolStatus; kind?: string; files?: string[] }
  | { type: "plan"; steps: { title: string; status: "pending" | "in_progress" | "completed" }[] }
  | { type: "permission"; request: PermissionRequest; reply(optionId: string | null): void }
  | { type: "notice"; level: "info" | "warning" | "error"; text: string }
  | { type: "end"; reason: EndReason; error?: string; code?: number };

export class AcpClient {
  readonly connection: acp.ClientConnection;
  info?: acp.InitializeResponse;
  private readonly sessions = new Map<string, AcpSession>();
  private readonly child?: ChildProcess;

  constructor(transport: acp.Stream | acp.AgentApp, child?: ChildProcess) {
    this.child = child;
    const app = acp
      .client({ name: "Get Frames" })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        this.sessions.get(params.sessionId)?.onUpdate(params.update);
      })
      .onRequest(acp.methods.client.session.requestPermission, ({ params, signal }) => {
        const session = this.sessions.get(params.sessionId);
        return session ? session.onPermission(params, signal) : cancelledOutcome();
      });
    this.connection = transport instanceof acp.AgentApp ? app.connect(transport) : app.connect(transport);
    void this.connection.closed.then(() => {
      for (const s of this.sessions.values()) s.onClosed();
    });
  }

  /** Starts the agent process and speaks ACP over its stdin/stdout; stderr goes to `onStderr`. */
  static spawn(launch: Launch, onStderr?: (text: string) => void): AcpClient {
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stderr?.on("data", (d: Buffer) => onStderr?.(d.toString()));
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    );
    const client = new AcpClient(stream, child);
    child.on("exit", () => client.connection.close(new Error("The agent process exited")));
    child.on("error", (err) => client.connection.close(err));
    return client;
  }

  get closed(): Promise<void> {
    return this.connection.closed;
  }

  get isClosed(): boolean {
    return this.connection.signal.aborted;
  }

  async initialize(version: string): Promise<acp.InitializeResponse> {
    this.info = await this.connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "get-frames", title: "Get Frames", version },
    });
    return this.info;
  }

  /** Whether the agent can reach MCP servers over HTTP (the Studio tools). */
  get supportsHttpMcp(): boolean {
    return this.info?.agentCapabilities?.mcpCapabilities?.http === true;
  }

  async newSession(cwd: string, mcpServers: acp.McpServer[], opts: SessionOptions = {}): Promise<AcpSession> {
    const res = await this.connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers, ...(opts.meta && { _meta: opts.meta }) });
    const session = this.track(res.sessionId, mcpServers, opts.mode);
    return this.opened(session, res);
  }

  /**
   * Reopens a saved session: session/resume when the agent offers it (no
   * replay), else session/load with its replayed history dropped, since the
   * app keeps its own log. Rejects when the agent can do neither.
   */
  async resumeSession(sessionId: string, cwd: string, mcpServers: acp.McpServer[], opts: SessionOptions = {}): Promise<AcpSession> {
    const caps = this.info?.agentCapabilities;
    const params = { sessionId, cwd, mcpServers, ...(opts.meta && { _meta: opts.meta }) };
    if (caps?.sessionCapabilities?.resume) {
      const res = (await this.connection.agent.request(acp.methods.agent.session.resume, params)) as acp.ResumeSessionResponse | null;
      return this.opened(this.track(sessionId, mcpServers, opts.mode), res);
    }
    if (caps?.loadSession) {
      const session = this.track(sessionId, mcpServers, opts.mode);
      session.replaying = true;
      let res: acp.LoadSessionResponse | null;
      try {
        res = await this.connection.agent.request(acp.methods.agent.session.load, params);
      } catch (e) {
        this.sessions.delete(sessionId);
        throw e;
      } finally {
        session.replaying = false;
      }
      return this.opened(session, res);
    }
    throw new Error("This agent cannot reopen an earlier session");
  }

  close(): void {
    this.connection.close();
    if (this.child && this.child.exitCode === null) this.child.kill();
  }

  private track(sessionId: string, mcpServers: acp.McpServer[], mode?: ModeRule): AcpSession {
    const session = new AcpSession(sessionId, this, { servers: new Set(mcpServers.map((s) => s.name)), mode });
    this.sessions.set(sessionId, session);
    return session;
  }

  /** A session that cannot be kept in its modes is not used. */
  private async opened(session: AcpSession, res: SessionState | null): Promise<AcpSession> {
    try {
      await session.settle(res);
    } catch (e) {
      this.sessions.delete(session.id);
      throw e;
    }
    return session;
  }
}

export interface SessionOptions {
  /** the agent's own settings for the session (ACP _meta) */
  meta?: Record<string, unknown>;
  mode?: ModeRule;
}

/** What session/new, session/resume and session/load answer about the session's mode. */
type SessionState = Pick<acp.NewSessionResponse, "modes" | "configOptions">;

export class AcpSession {
  replaying = false;
  private turn?: EventQueue<AgentEvent>;
  private readonly pending = new Set<(optionId: string | null) => void>();
  /** the permission mode, as the agent last reported it */
  private mode?: string;
  /** what the turn's tool calls said about themselves, for permission requests that only name the call (Codex) */
  private readonly calls = new Map<string, { title?: string; rawInput?: unknown; meta?: unknown }>();

  constructor(
    readonly id: string,
    private readonly client: AcpClient,
    private readonly opts: { servers: ReadonlySet<string>; mode?: ModeRule } = { servers: new Set() },
  ) {}

  get busy(): boolean {
    return this.turn !== undefined;
  }

  /** Sends a prompt; the events end with one "end" event when the turn stops. */
  prompt(text: string): AsyncIterable<AgentEvent> {
    if (this.turn) throw new Error("The agent is still working on the previous message");
    const turn = new EventQueue<AgentEvent>();
    this.turn = turn;
    this.client.connection.agent
      .request(acp.methods.agent.session.prompt, { sessionId: this.id, prompt: [{ type: "text", text }] })
      .then(
        (res): AgentEvent => endEvent(res.stopReason),
        (err: unknown): AgentEvent => ({ type: "end", reason: "error", error: errorText(err), code: (err as { code?: number }).code }),
      )
      .then((end) => {
        // free before the end event is read, so a reply to it can start the next turn
        this.answerPending(null);
        this.calls.clear();
        if (this.turn === turn) this.turn = undefined;
        turn.push(end);
        turn.close();
      });
    return turn;
  }

  /** Asks the agent to stop the current turn; the turn then ends with reason "cancelled". */
  async cancel(): Promise<void> {
    if (!this.turn) return;
    await this.client.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.id }).catch(() => undefined);
    this.answerPending(null);
  }

  /** @internal the session opened: the mode it reported (or that came with its replay), set within the rule */
  async settle(res: SessionState | null): Promise<void> {
    const reported = res?.modes?.currentModeId ?? modeOption(res?.configOptions) ?? this.mode;
    if (reported) this.mode = reported;
    const rule = this.opts.mode;
    if (!rule || (reported !== undefined && rule.allowed.includes(reported))) return;
    try {
      await this.setMode(rule.start);
      this.mode = rule.start;
    } catch (e) {
      // an agent that said nothing of modes and has none: nothing to keep
      if (reported === undefined && (e as { code?: number }).code === METHOD_NOT_FOUND) return;
      throw new Error(`Không đưa được agent về chế độ "${rule.start}" (đang ở "${reported ?? "không rõ"}"): ${errorText(e)}`);
    }
  }

  /** @internal */
  onUpdate(update: acp.SessionUpdate): void {
    // the mode counts whenever it changes, also between turns; a replay's is only noted: settle() decides once the load is done
    const mode = update.sessionUpdate === "current_mode_update" ? update.currentModeId : update.sessionUpdate === "config_option_update" ? modeOption(update.configOptions) : undefined;
    if (mode !== undefined && this.replaying) this.mode = mode;
    else if (mode !== undefined) this.onMode(mode);
    if (this.replaying || !this.turn) return;
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") this.remember(update);
    const event = toEvent(update);
    if (event) this.turn.push(event);
  }

  /** @internal */
  onPermission(params: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse> {
    const turn = this.turn;
    if (!turn || this.replaying) return Promise.resolve(cancelledOutcome());
    return new Promise((resolve) => {
      let answered = false;
      const reply = (optionId: string | null) => {
        if (answered) return;
        answered = true;
        this.pending.delete(reply);
        resolve(optionId ? { outcome: { outcome: "selected", optionId } } : cancelledOutcome());
      };
      this.pending.add(reply);
      signal.addEventListener("abort", () => reply(null), { once: true });
      turn.push({ type: "permission", request: toPermissionRequest(params, this.calls.get(params.toolCall.toolCallId), this.opts.servers), reply });
    });
  }

  /** @internal the connection closed: end the running turn */
  onClosed(): void {
    const turn = this.turn;
    this.answerPending(null);
    this.turn = undefined;
    turn?.push({ type: "end", reason: "error", error: "Tiến trình agent đã dừng" });
    turn?.close();
  }

  private answerPending(optionId: string | null): void {
    for (const reply of [...this.pending]) reply(optionId);
  }

  private remember(u: acp.ToolCall | acp.ToolCallUpdate): void {
    const known = this.calls.get(u.toolCallId) ?? {};
    this.calls.set(u.toolCallId, {
      title: u.title ?? known.title,
      rawInput: u.rawInput ?? known.rawInput,
      meta: u._meta ?? known.meta,
    });
  }

  private setMode(modeId: string): Promise<unknown> {
    return this.client.connection.agent.request(acp.methods.agent.session.setMode, { sessionId: this.id, modeId });
  }

  /** The agent is in a new mode: one the rule does not allow is set back, and an agent that will not go back is stopped. */
  private onMode(mode: string): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const rule = this.opts.mode;
    if (!rule || rule.allowed.includes(mode)) return;
    this.turn?.push({ type: "notice", level: "warning", text: `Agent chuyển sang chế độ "${mode}", nơi nó tự quyết thay app; app đưa nó về "${rule.start}".` });
    this.setMode(rule.start).then(
      () => {
        // the agent may not report the switch it was asked for
        if (this.mode === mode) this.mode = rule.start;
      },
      (e: unknown) => {
        this.turn?.push({ type: "notice", level: "error", text: `Agent không quay về chế độ "${rule.start}" (${errorText(e)}), nên app dừng agent.` });
        this.client.close();
      },
    );
  }
}

/** JSON-RPC "method not found" */
const METHOD_NOT_FOUND = -32601;

/** The current value of a session's mode option (agents that describe their modes as a config option). */
function modeOption(options: acp.SessionConfigOption[] | null | undefined): string | undefined {
  const option = options?.find((o) => o.category === "mode" && o.type === "select");
  return option && "currentValue" in option && typeof option.currentValue === "string" ? option.currentValue : undefined;
}

function cancelledOutcome(): acp.RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } };
}

function endEvent(stop: acp.StopReason): AgentEvent {
  switch (stop) {
    case "end_turn":
      return { type: "end", reason: "done" };
    case "cancelled":
      return { type: "end", reason: "cancelled" };
    case "refusal":
      return { type: "end", reason: "refusal" };
    default:
      return { type: "end", reason: "limit", error: stop };
  }
}

const TOOL_STATUS: Record<string, ToolStatus> = { pending: "pending", in_progress: "running", completed: "done", failed: "failed" };

function toEvent(u: acp.SessionUpdate): AgentEvent | undefined {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      if (u.content.type !== "text") return undefined;
      return { type: u.sessionUpdate === "agent_message_chunk" ? "message" : "thought", text: u.content.text, messageId: u.messageId ?? undefined };
    }
    case "tool_call":
      return {
        type: "tool",
        id: u.toolCallId,
        title: u.title,
        status: TOOL_STATUS[u.status ?? "pending"] ?? "pending",
        kind: u.kind,
        files: u.locations?.map((l) => l.path),
      };
    case "tool_call_update":
      return {
        type: "tool",
        id: u.toolCallId,
        title: u.title ?? undefined,
        status: u.status ? TOOL_STATUS[u.status] : undefined,
        kind: u.kind ?? undefined,
        files: u.locations?.map((l) => l.path),
      };
    case "plan":
      return { type: "plan", steps: u.entries.map((e) => ({ title: e.content, status: e.status })) };
    case "notice": {
      const level = u.severity === "warning" || u.severity === "error" ? u.severity : "info";
      return { type: "notice", level, text: [u.title, u.description].filter(Boolean).join(": ") };
    }
    default:
      return undefined;
  }
}

type Meta = Record<string, unknown> | null | undefined;

/**
 * A permission request as the policy reads it. `known` is what the tool call
 * said about itself earlier in the turn; `servers` are the MCP servers the app
 * passed to the session.
 */
export function toPermissionRequest(p: acp.RequestPermissionRequest, known: { title?: string; rawInput?: unknown; meta?: unknown } = {}, servers: ReadonlySet<string> = new Set()): PermissionRequest {
  const call = p.toolCall;
  const claude = (call._meta as Meta)?.claudeCode as { toolName?: string; mcpServer?: { name?: unknown; source?: unknown } } | undefined;
  const permission = (p._meta as Meta)?.permission as { title?: string; description?: string } | undefined;
  const rawInput = call.rawInput ?? known.rawInput;
  const devin = (call._meta as Meta)?.["cognition.ai/toolName"] ?? (known.meta as Meta)?.["cognition.ai/toolName"];
  const devinTool = typeof devin === "string" ? devin : undefined;
  return {
    toolCallId: call.toolCallId,
    title: permission?.title ?? call.title ?? known.title ?? "Use a tool",
    kind: call.kind ?? undefined,
    tool: call.name ?? claude?.toolName ?? devinTool,
    mcp: mcpTool(p, { claude, devinTool, known }, rawInput, servers),
    paths: call.locations?.map((l) => l.path) ?? [],
    rawInput,
    reason: typeof permission?.description === "string" && permission.description.trim() ? permission.description.trim() : undefined,
    options: p.options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
  };
}

/**
 * The MCP tool a request is for, in each agent's words. Only what the agent
 * itself says counts (its _meta): a tool's input is the model's to write, and
 * any tool's input can carry keys that name a server.
 */
function mcpTool(
  p: acp.RequestPermissionRequest,
  said: { claude?: { toolName?: string; mcpServer?: { name?: unknown; source?: unknown } }; devinTool?: string; known: { rawInput?: unknown; meta?: unknown } },
  rawInput: unknown,
  servers: ReadonlySet<string>,
): PermissionRequest["mcp"] {
  const record = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const input = record(rawInput);
  // Claude Code: the tool is mcp__<server>__<tool>, and it says where the server was configured ("dynamic": passed by the app)
  const { claude } = said;
  if (claude) {
    const server = claude.mcpServer?.name;
    const prefix = `mcp__${String(server)}__`;
    if (typeof server !== "string" || !claude.toolName?.startsWith(prefix)) return undefined;
    return { server, tool: claude.toolName.slice(prefix.length), fromApp: claude.mcpServer?.source === "dynamic" && servers.has(server) };
  }
  // Codex: the approval names only the tool call; the adapter marked that call as an MCP call, whose input it wrote as {server, tool, arguments}
  if ((p._meta as Meta)?.is_mcp_tool_approval === true && (said.known.meta as Meta)?.is_mcp_tool_call === true) {
    const call = record(said.known.rawInput);
    return typeof call.server === "string" && typeof call.tool === "string" ? { server: call.server, tool: call.tool, fromApp: servers.has(call.server) } : undefined;
  }
  // Devin: its mcp_call_tool takes {server_name, tool_name, arguments}
  if (said.devinTool === "mcp_call_tool" && typeof input.server_name === "string" && typeof input.tool_name === "string") {
    return { server: input.server_name, tool: input.tool_name, fromApp: servers.has(input.server_name) };
  }
  return undefined;
}

/** A JSON-RPC error's message, with the details agents put in its data ("Internal error: spawn claude ENOENT"). */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const details = (err as { data?: { details?: unknown } }).data?.details;
  return typeof details === "string" && details.trim() && !err.message.includes(details) ? `${err.message}: ${details.trim()}` : err.message;
}

/** Push-based async iterable: events queue up until the consumer reads them. */
export class EventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiting?: (r: IteratorResult<T>) => void;
  private done = false;

  push(item: T): void {
    if (this.done) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = undefined;
      w({ value: item, done: false });
    } else this.items.push(item);
  }

  close(): void {
    this.done = true;
    if (this.waiting && this.items.length === 0) {
      const w = this.waiting;
      this.waiting = undefined;
      w({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => (this.waiting = r));
      },
    };
  }
}
