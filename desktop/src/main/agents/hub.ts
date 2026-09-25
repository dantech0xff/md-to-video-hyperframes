/**
 * Agent Hub: one agent session per project. It starts the agent with the
 * project folder as working directory and the project's Studio tools, sends
 * the user's messages, turns the agent's events into the activity log the
 * project screen shows, answers permission requests by the policy (or asks the
 * user), and keeps the session id in project.json so the conversation can
 * continue after a restart.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { McpServer } from "@agentclientprotocol/sdk";
import type { ActivityEntry, ActivityEvent, AgentId, AgentState } from "../../shared/types";
import { APP_DIR, type ProjectStore } from "../projects";
import { FRESH_SESSION_NOTE } from "../prompts";
import { AcpClient, errorText, type AcpSession, type AgentEvent, type Launch } from "./acp";
import { decide, STUDIO_SERVER } from "./policy";

const LOG_FILE = "activity.json";
const MAX_ENTRIES = 1500;
/** JSON-RPC code of ACP's "authentication required" */
const AUTH_REQUIRED = -32000;

export interface HubDeps {
  version: string;
  projects: ProjectStore;
  /** Studio tools for a project folder: server URL and the project's own token */
  studio(dir: string): Promise<{ url: string; token: string }>;
  /** how to start the project's agent; throws a message for the user when it cannot run */
  launch(agent: AgentId, cwd: string): Promise<Launch>;
  emit(event: ActivityEvent): void;
  /** for tests: connect without spawning */
  connect?: (launch: Launch) => AcpClient;
  log?: (line: string) => void;
}

interface Live {
  entries: ActivityEntry[];
  state: AgentState;
  client?: AcpClient;
  session?: AcpSession;
  /** unanswered permission requests, by activity entry id */
  pending: Map<string, (optionId: string | null) => void>;
  /** activity entry of each tool call */
  tools: Map<string, string>;
  saveTimer?: NodeJS.Timeout;
  loaded: boolean;
}

export class AgentHub {
  private readonly live = new Map<string, Live>();
  private seq = 0;

  constructor(private readonly deps: HubDeps) {}

  state(projectId: string): AgentState {
    return this.live.get(projectId)?.state ?? "idle";
  }

  async activity(projectId: string): Promise<{ entries: ActivityEntry[]; state: AgentState }> {
    const live = await this.load(projectId);
    return { entries: live.entries, state: live.state };
  }

  /**
   * Sends a message to the project's agent, starting or reopening its session
   * first. Resolves once the message is on its way; the turn runs on and
   * reports through events.
   */
  async send(projectId: string, text: string): Promise<void> {
    const live = await this.load(projectId);
    if (live.state === "working" || live.state === "waiting") throw new Error("Agent đang làm việc; chờ xong hoặc bấm Dừng trước khi gửi tiếp.");
    this.add(projectId, live, { kind: "user", text });
    this.setState(projectId, live, "working");
    void this.turn(projectId, live, text);
  }

  async cancel(projectId: string): Promise<void> {
    const live = this.live.get(projectId);
    if (!live?.session) return;
    await live.session.cancel();
  }

  /** The user's answer to a permission request; null declines it. */
  answer(projectId: string, entryId: string, optionId: string | null): void {
    const live = this.live.get(projectId);
    const reply = live?.pending.get(entryId);
    if (!live || !reply) return;
    reply(optionId);
  }

  /** Stops the project's agent process (the session stays saved for next time). */
  closeProject(projectId: string): void {
    const live = this.live.get(projectId);
    if (!live) return;
    live.client?.close();
    live.client = undefined;
    live.session = undefined;
  }

  async closeAll(): Promise<void> {
    for (const [id, live] of this.live) {
      live.client?.close();
      await this.save(id, live);
    }
  }

  // ── turns ────────────────────────────────────────────────────────────────

  private async turn(projectId: string, live: Live, text: string): Promise<void> {
    let session: AcpSession;
    let prefix = "";
    try {
      ({ session, prefix } = await this.ensureSession(projectId, live));
    } catch (e) {
      this.deps.log?.(`[${projectId}] ${(e as Error).message}`);
      this.add(projectId, live, { kind: "notice", level: "error", text: (e as Error).message });
      this.add(projectId, live, { kind: "end", reason: "error" });
      this.setState(projectId, live, "error");
      await this.save(projectId, live);
      return;
    }

    const dir = this.deps.projects.dir(projectId);
    let lastKind: string | undefined;
    for await (const ev of session.prompt(prefix + text)) {
      try {
        this.onEvent(projectId, live, dir, ev, lastKind);
      } catch (e) {
        this.deps.log?.(`[${projectId}] could not handle ${ev.type}: ${(e as Error).stack}`);
      }
      lastKind = ev.type;
    }
    await this.save(projectId, live);
  }

  private onEvent(projectId: string, live: Live, dir: string, ev: AgentEvent, lastKind: string | undefined): void {
    switch (ev.type) {
      case "message":
      case "thought": {
        const last = live.entries.at(-1);
        // chunks of one message keep growing the same entry
        if (last && last.kind === ev.type && lastKind === ev.type) {
          last.text += ev.text;
          this.deps.emit({ projectId, type: "entry", entry: last });
          this.scheduleSave(projectId, live);
        } else if (ev.text.trim()) this.add(projectId, live, { kind: ev.type, text: ev.text });
        return;
      }
      case "tool": {
        const files = ev.files?.map((f) => display(dir, f));
        const existing = live.tools.get(ev.id);
        const entry = existing ? live.entries.find((e) => e.id === existing) : undefined;
        if (entry && entry.kind === "tool") {
          if (ev.title) entry.title = ev.title;
          if (ev.status) entry.status = ev.status;
          if (ev.kind) entry.toolKind = ev.kind;
          if (files?.length) entry.files = files;
          this.deps.emit({ projectId, type: "entry", entry });
          this.scheduleSave(projectId, live);
        } else {
          const added = this.add(projectId, live, { kind: "tool", title: ev.title ?? "Công cụ", status: ev.status ?? "pending", toolKind: ev.kind, files });
          live.tools.set(ev.id, added.id);
        }
        return;
      }
      case "plan": {
        const last = [...live.entries].reverse().find((e) => e.kind === "plan" || e.kind === "user");
        if (last?.kind === "plan") {
          last.steps = ev.steps;
          this.deps.emit({ projectId, type: "entry", entry: last });
        } else this.add(projectId, live, { kind: "plan", steps: ev.steps });
        return;
      }
      case "permission": {
        const decision = decide(ev.request, dir);
        if (decision.allow) {
          this.deps.log?.(`[${projectId}] allowed (${decision.reason}): ${ev.request.title}`);
          ev.reply(decision.optionId);
          return;
        }
        const entry = this.add(projectId, live, {
          kind: "permission",
          title: ev.request.title,
          detail: permissionDetail(ev.request.rawInput, ev.request.paths.map((p) => display(dir, p))),
          options: ev.request.options,
        });
        this.setState(projectId, live, "waiting");
        live.pending.set(entry.id, (optionId) => {
          live.pending.delete(entry.id);
          if (entry.kind === "permission") entry.answer = optionId ?? "cancelled";
          this.deps.emit({ projectId, type: "entry", entry });
          if (live.pending.size === 0 && live.state === "waiting") this.setState(projectId, live, "working");
          ev.reply(optionId);
        });
        return;
      }
      case "notice":
        this.add(projectId, live, { kind: "notice", level: ev.level, text: ev.text });
        return;
      case "end": {
        for (const reply of [...live.pending.values()]) reply(null);
        const error = ev.code === AUTH_REQUIRED ? "Claude Code chưa đăng nhập. Mở Terminal, chạy `claude` và đăng nhập, rồi gửi lại." : ev.error;
        this.add(projectId, live, { kind: "end", reason: ev.reason, error });
        this.setState(projectId, live, ev.reason === "error" ? "error" : "idle");
        return;
      }
    }
  }

  /** The live session, or a reopened or new one. `prefix` goes before the message when earlier context was lost. */
  private async ensureSession(projectId: string, live: Live): Promise<{ session: AcpSession; prefix: string }> {
    if (live.session && live.client && !live.client.isClosed) return { session: live.session, prefix: "" };

    const { projects } = this.deps;
    const dir = projects.dir(projectId);
    // the shipped skill and AGENTS.md always match this version of the app
    await projects.prepareAgentFiles(projectId);
    const project = await projects.read(projectId);
    const launch = await this.deps.launch(project.agent.id, dir);
    const client = (this.deps.connect ?? ((l) => AcpClient.spawn(l, (t) => this.deps.log?.(`[${projectId}] agent: ${t.trimEnd()}`))))(launch);
    let prefix = "";
    let session: AcpSession | undefined;
    try {
      await client.initialize(this.deps.version);
      if (!client.supportsHttpMcp) throw new Error("Agent này không hỗ trợ MCP qua HTTP nên không dùng được Studio tools.");

      const studio = await this.deps.studio(dir);
      const mcpServers: McpServer[] = [
        { type: "http", name: STUDIO_SERVER, url: studio.url, headers: [{ name: "Authorization", value: `Bearer ${studio.token}` }] },
      ];
      if (project.agent.sessionId) {
        try {
          session = await client.resumeSession(project.agent.sessionId, dir, mcpServers);
        } catch (e) {
          this.deps.log?.(`[${projectId}] could not reopen session ${project.agent.sessionId}: ${(e as Error).message}`);
          prefix = FRESH_SESSION_NOTE;
        }
      }
      if (!session) {
        session = await client.newSession(dir, mcpServers);
        const id = session.id;
        await projects.update(projectId, (p) => (p.agent.sessionId = id));
      }
    } catch (e) {
      client.close();
      throw new Error(startError(e));
    }
    live.client = client;
    live.session = session;
    void client.closed.then(() => {
      if (live.client === client) {
        live.client = undefined;
        live.session = undefined;
      }
    });
    return { session, prefix };
  }

  // ── log ──────────────────────────────────────────────────────────────────

  private async load(projectId: string): Promise<Live> {
    let live = this.live.get(projectId);
    if (live?.loaded) return live;
    live = { entries: [], state: "idle", pending: new Map(), tools: new Map(), loaded: true };
    this.live.set(projectId, live);
    const file = join(this.deps.projects.dir(projectId), APP_DIR, LOG_FILE);
    if (existsSync(file)) {
      try {
        live.entries = JSON.parse(await readFile(file, "utf8")) as ActivityEntry[];
        // requests from a session that is gone can no longer be answered
        for (const e of live.entries) if (e.kind === "permission" && !e.answer) e.answer = "cancelled";
        for (const e of live.entries) if (e.kind === "tool" && (e.status === "pending" || e.status === "running")) e.status = "failed";
      } catch {
        live.entries = [];
      }
    }
    return live;
  }

  private add(projectId: string, live: Live, entry: DistributiveOmit<ActivityEntry, "id" | "at">): ActivityEntry {
    const full = { ...entry, id: `${Date.now().toString(36)}-${(this.seq++).toString(36)}`, at: new Date().toISOString() } as ActivityEntry;
    live.entries.push(full);
    if (live.entries.length > MAX_ENTRIES) live.entries.splice(0, live.entries.length - MAX_ENTRIES);
    this.deps.emit({ projectId, type: "entry", entry: full });
    this.scheduleSave(projectId, live);
    return full;
  }

  private setState(projectId: string, live: Live, state: AgentState): void {
    live.state = state;
    this.deps.emit({ projectId, type: "state", state });
  }

  private scheduleSave(projectId: string, live: Live): void {
    if (live.saveTimer) return;
    live.saveTimer = setTimeout(() => void this.save(projectId, live), 1000);
  }

  private async save(projectId: string, live: Live): Promise<void> {
    clearTimeout(live.saveTimer);
    live.saveTimer = undefined;
    try {
      const dir = join(this.deps.projects.dir(projectId), APP_DIR);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, LOG_FILE), JSON.stringify(live.entries));
    } catch (e) {
      this.deps.log?.(`[${projectId}] could not save the activity log: ${(e as Error).message}`);
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Why the agent could not start, for the user. */
function startError(e: unknown): string {
  if ((e as { code?: number }).code === AUTH_REQUIRED) return "Claude Code chưa đăng nhập. Mở Terminal, chạy `claude` và đăng nhập, rồi gửi lại.";
  return `Không khởi động được agent: ${errorText(e)}`;
}

/** Project-relative path when inside the project, the full path otherwise. */
function display(dir: string, p: string): string {
  const rel = relative(dir, p);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : p;
}

/** What a request would do, for the user to judge: the command, URL or paths. */
function permissionDetail(raw: unknown, paths: string[]): string | undefined {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const key of ["command", "url", "query"]) if (typeof input[key] === "string") return input[key] as string;
  return paths.length ? paths.join("\n") : undefined;
}
