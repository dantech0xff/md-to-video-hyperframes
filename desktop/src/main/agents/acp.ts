/**
 * ACP client: one agent process (Claude Code through its adapter today; Codex
 * and Devin later), its sessions, and each prompt turn as a stream of events
 * the Agent Hub turns into the activity log.
 *
 * Turn protocol: session/prompt → session/update notifications (messages,
 * thoughts, tool calls, plans) and session/request_permission requests →
 * the prompt response with a stop reason. Cancelling sends session/cancel
 * and answers every pending permission request with "cancelled".
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
}

export type ToolStatus = "pending" | "running" | "done" | "failed";

export interface PermissionRequest {
  toolCallId: string;
  title: string;
  /** ACP tool kind: read, edit, execute, fetch, other… */
  kind?: string;
  /** the agent's own tool name, when it says (Claude: "Bash", "mcp__studio__check_layout") */
  tool?: string;
  /** MCP server of an MCP tool, when the agent says */
  mcpServer?: string;
  /** paths the tool touches */
  paths: string[];
  rawInput?: unknown;
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

  async newSession(cwd: string, mcpServers: acp.McpServer[]): Promise<AcpSession> {
    const res = await this.connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers });
    return this.track(res.sessionId);
  }

  /**
   * Reopens a saved session: session/resume when the agent offers it (no
   * replay), else session/load with its replayed history dropped, since the
   * app keeps its own log. Rejects when the agent can do neither.
   */
  async resumeSession(sessionId: string, cwd: string, mcpServers: acp.McpServer[]): Promise<AcpSession> {
    const caps = this.info?.agentCapabilities;
    if (caps?.sessionCapabilities?.resume) {
      await this.connection.agent.request(acp.methods.agent.session.resume, { sessionId, cwd, mcpServers });
      return this.track(sessionId);
    }
    if (caps?.loadSession) {
      const session = this.track(sessionId);
      session.replaying = true;
      try {
        await this.connection.agent.request(acp.methods.agent.session.load, { sessionId, cwd, mcpServers });
      } catch (e) {
        this.sessions.delete(sessionId);
        throw e;
      } finally {
        session.replaying = false;
      }
      return session;
    }
    throw new Error("This agent cannot reopen an earlier session");
  }

  close(): void {
    this.connection.close();
    if (this.child && this.child.exitCode === null) this.child.kill();
  }

  private track(sessionId: string): AcpSession {
    const session = new AcpSession(sessionId, this);
    this.sessions.set(sessionId, session);
    return session;
  }
}

export class AcpSession {
  replaying = false;
  private turn?: EventQueue<AgentEvent>;
  private readonly pending = new Set<(optionId: string | null) => void>();

  constructor(
    readonly id: string,
    private readonly client: AcpClient,
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

  /** @internal */
  onUpdate(update: acp.SessionUpdate): void {
    if (this.replaying || !this.turn) return;
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
      turn.push({ type: "permission", request: toPermissionRequest(params), reply });
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

function toPermissionRequest(p: acp.RequestPermissionRequest): PermissionRequest {
  const call = p.toolCall;
  const claude = (call._meta as { claudeCode?: { toolName?: string; mcpServer?: { name?: string } } } | null | undefined)?.claudeCode;
  const permission = (p._meta as { permission?: { title?: string } } | null | undefined)?.permission;
  return {
    toolCallId: call.toolCallId,
    title: permission?.title ?? call.title ?? "Use a tool",
    kind: call.kind ?? undefined,
    tool: call.name ?? claude?.toolName ?? undefined,
    mcpServer: claude?.mcpServer?.name,
    paths: call.locations?.map((l) => l.path) ?? [],
    rawInput: call.rawInput,
    options: p.options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
  };
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
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
