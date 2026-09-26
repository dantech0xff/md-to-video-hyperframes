/**
 * Agent Hub: one agent session per project. It starts the agent with the
 * project folder as working directory and the project's Studio tools, sends
 * the user's messages, turns the agent's events into the activity log the
 * project screen shows, answers permission requests by the policy (or asks the
 * user), and keeps the session id in project.json so the conversation can
 * continue after a restart.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { McpServer } from "@agentclientprotocol/sdk";
import { AGENTS, isAgentId } from "../../shared/agents";
import type { ActivityEntry, ActivityEvent, AgentId, AgentState } from "../../shared/types";
import { APP_DIR, type ProjectStore } from "../projects";
import { editsNote, FRESH_SESSION_NOTE } from "../prompts";
import { AcpClient, errorText, type AcpSession, type AgentEvent, type Launch } from "./acp";
import { agentConfigFiles, decide, oneTimeOptions, STUDIO_SERVER } from "./policy";

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
  /** the project's folder, fixed for as long as the record lives: its session and log stay there */
  dir: string;
  /** the agent of the open (or last opened) session */
  agent?: AgentId;
  entries: ActivityEntry[];
  state: AgentState;
  client?: AcpClient;
  session?: AcpSession;
  /** unanswered permission requests, by activity entry id */
  pending: Map<string, (optionId: string | null) => void>;
  /** activity entry of each tool call */
  tools: Map<string, string>;
  saveTimer?: NodeJS.Timeout;
  /** the turn is still opening its session; Stop then ends it before its message goes out */
  opening?: boolean;
  stopped?: boolean;
  /** a note for the agent that has not reached it yet (the earlier session was lost) */
  note?: string;
  /** saves run one after another; each writes a fresh copy and swaps it in */
  saving?: Promise<void>;
}

export class AgentHub {
  private readonly live = new Map<string, Live>();
  /** each project's log is read once; callers during the read wait for the same record */
  private readonly loading = new Map<string, Promise<Live>>();
  private seq = 0;

  constructor(private readonly deps: HubDeps) {}

  state(projectId: string): AgentState {
    return this.live.get(projectId)?.state ?? "idle";
  }

  /** Some agent is working or waiting for the user. */
  busy(): boolean {
    return [...this.live.values()].some((l) => l.state === "working" || l.state === "waiting");
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
    void this.turn(projectId, live, text).catch((e: Error) => this.deps.log?.(`[${projectId}] turn failed: ${e.stack ?? e.message}`));
  }

  async cancel(projectId: string): Promise<void> {
    const live = this.live.get(projectId);
    if (!live) return;
    if (live.opening) live.stopped = true;
    else await live.session?.cancel();
  }

  /** The user's answer to a permission request: one of the options it offered, or null to decline it. */
  answer(projectId: string, entryId: string, optionId: string | null): void {
    const live = this.live.get(projectId);
    const reply = live?.pending.get(entryId);
    if (!live || !reply) return;
    const entry = live.entries.find((e) => e.id === entryId);
    if (optionId !== null && !(entry?.kind === "permission" && entry.options.some((o) => o.id === optionId))) throw new Error("Lựa chọn này không có trong yêu cầu của agent");
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

  /** Stops every agent process (app quit, engine restart); saved sessions continue on the next message. */
  async closeAll(): Promise<void> {
    for (const [id, live] of this.live) {
      live.client?.close();
      live.client = undefined;
      live.session = undefined;
      await this.save(id, live);
    }
  }

  /** The projects folder changed: its projects' records go (after closeAll); a project is read from where it is now. */
  forget(): void {
    this.live.clear();
    this.loading.clear();
  }

  // ── turns ────────────────────────────────────────────────────────────────

  private async turn(projectId: string, live: Live, text: string): Promise<void> {
    let session: AcpSession;
    let prefix = "";
    live.opening = true;
    live.stopped = false;
    try {
      ({ session, prefix } = await this.ensureSession(projectId, live));
    } catch (e) {
      this.deps.log?.(`[${projectId}] ${(e as Error).message}`);
      if (live.stopped) {
        // the user stopped it while it was starting: that is how it ended
        this.add(projectId, live, { kind: "end", reason: "cancelled" });
        this.setState(projectId, live, "idle");
      } else {
        this.add(projectId, live, { kind: "notice", level: "error", text: (e as Error).message });
        this.add(projectId, live, { kind: "end", reason: "error" });
        this.setState(projectId, live, "error");
      }
      await this.save(projectId, live);
      return;
    } finally {
      live.opening = false;
    }
    const note = prefix || live.note || "";
    if (live.stopped) {
      // Stop came while the session opened: the message never goes out, the note waits for the next one
      live.note = note || undefined;
      this.add(projectId, live, { kind: "end", reason: "cancelled" });
      this.setState(projectId, live, "idle");
      await this.save(projectId, live);
      return;
    }
    live.note = undefined;
    const edits = await this.takeEdits(projectId);

    let lastKind: string | undefined;
    try {
      for await (const ev of session.prompt(note + edits + text)) {
        try {
          this.onEvent(projectId, live, live.dir, ev, lastKind);
        } catch (e) {
          this.deps.log?.(`[${projectId}] could not handle ${ev.type}: ${(e as Error).stack}`);
        }
        lastKind = ev.type;
      }
    } catch (e) {
      // whatever went wrong, the turn ends where the user sees it instead of staying "working"
      this.deps.log?.(`[${projectId}] turn failed: ${(e as Error).stack ?? (e as Error).message}`);
      for (const reply of [...live.pending.values()]) reply(null);
      this.add(projectId, live, { kind: "notice", level: "error", text: (e as Error).message });
      this.add(projectId, live, { kind: "end", reason: "error" });
      this.setState(projectId, live, "error");
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
          detail: permissionDetail(ev.request.rawInput, ev.request.paths.map((p) => display(dir, p)), ev.request.reason),
          options: oneTimeOptions(ev.request.options),
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
        const error = ev.code === AUTH_REQUIRED ? loginNeeded(live.agent) : ev.error;
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
    const { dir } = live;
    const project = await projects.read(projectId);
    const agent = project.agent.id;
    if (!isAgentId(agent)) throw new Error(`Dự án dùng agent "${String(agent)}" mà bản app này không biết.`);
    live.agent = agent;
    // the agent would read these as it starts: their hooks and servers run before any request reaches the app
    const config = agentConfigFiles(dir, agent);
    if (config.length) {
      throw new Error(
        `Dự án có cấu hình agent không do app tạo: ${config.join(", ")}. Các file này có thể chạy lệnh hoặc tự cho phép công cụ mà app không kiểm soát được, nên app không mở agent. Nếu bạn không tự đặt chúng vào, hãy xoá (hoặc chuyển ra ngoài thư mục dự án) rồi gửi lại.`,
      );
    }
    // the shipped skill and AGENTS.md always match this version of the app
    await projects.prepareAgentFiles(projectId);
    const launch = await this.deps.launch(agent, dir);
    const options = { meta: launch.sessionMeta, mode: launch.mode };
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
          session = await client.resumeSession(project.agent.sessionId, dir, mcpServers, options);
        } catch (e) {
          this.deps.log?.(`[${projectId}] could not reopen session ${project.agent.sessionId}: ${(e as Error).message}`);
          prefix = FRESH_SESSION_NOTE;
        }
      }
      if (!session) {
        session = await client.newSession(dir, mcpServers, options);
        const id = session.id;
        await projects.update(projectId, (p) => (p.agent.sessionId = id));
      }
    } catch (e) {
      client.close();
      throw new Error(startError(e, agent));
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

  /** What the user edited in the app since the agent's last turn, for the message going out now; project.json forgets it then. */
  private async takeEdits(projectId: string): Promise<string> {
    let edited: Record<string, string[]> | undefined;
    try {
      // most turns follow no edit: project.json is written only when there is one to take
      if (!(await this.deps.projects.read(projectId)).agent.edited) return "";
      await this.deps.projects.update(projectId, (p) => {
        edited = p.agent.edited;
        delete p.agent.edited;
      });
    } catch (e) {
      this.deps.log?.(`[${projectId}] could not read the user's edits: ${(e as Error).message}`);
    }
    return edited ? editsNote(edited) : "";
  }

  // ── log ──────────────────────────────────────────────────────────────────

  private load(projectId: string): Promise<Live> {
    let loading = this.loading.get(projectId);
    if (!loading) {
      loading = this.readLog(projectId).then((live) => {
        this.live.set(projectId, live);
        return live;
      });
      this.loading.set(projectId, loading);
      // a project that could not be read is read again next time
      loading.catch(() => this.loading.delete(projectId));
    }
    return loading;
  }

  /** The saved activity log; the record is shared only once it holds the log. */
  private async readLog(projectId: string): Promise<Live> {
    const live: Live = { dir: this.deps.projects.dir(projectId), entries: [], state: "idle", pending: new Map(), tools: new Map() };
    const file = join(live.dir, APP_DIR, LOG_FILE);
    if (!existsSync(file)) return live;
    try {
      live.entries = JSON.parse(await readFile(file, "utf8")) as ActivityEntry[];
      // requests from a session that is gone can no longer be answered
      for (const e of live.entries) if (e.kind === "permission" && !e.answer) e.answer = "cancelled";
      for (const e of live.entries) if (e.kind === "tool" && (e.status === "pending" || e.status === "running")) e.status = "failed";
    } catch {
      live.entries = [];
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

  /** Writes the log: one save at a time, into a new file renamed over the old, so a log on disk is always whole. */
  private save(projectId: string, live: Live): Promise<void> {
    clearTimeout(live.saveTimer);
    live.saveTimer = undefined;
    const write = async () => {
      try {
        const dir = join(live.dir, APP_DIR);
        await mkdir(dir, { recursive: true });
        const file = join(dir, LOG_FILE);
        await writeFile(`${file}.tmp`, JSON.stringify(live.entries));
        await rename(`${file}.tmp`, file);
      } catch (e) {
        this.deps.log?.(`[${projectId}] could not save the activity log: ${(e as Error).message}`);
      }
    };
    live.saving = (live.saving ?? Promise.resolve()).then(write);
    return live.saving;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Why the agent could not start, for the user. */
function startError(e: unknown, agent: AgentId): string {
  if ((e as { code?: number }).code === AUTH_REQUIRED) return loginNeeded(agent);
  return `Không khởi động được ${AGENTS[agent].name}: ${errorText(e)}`;
}

function loginNeeded(agent: AgentId = "claude-code"): string {
  const { name, loginCommand } = AGENTS[agent];
  return `${name} chưa đăng nhập. Mở Terminal, chạy \`${loginCommand}\` và đăng nhập, rồi gửi lại.`;
}

/** Project-relative path when inside the project, the full path otherwise. */
function display(dir: string, p: string): string {
  const rel = relative(dir, p);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : p;
}

/** What a request would do, for the user to judge: the command, URL or paths, and the agent's reason. */
function permissionDetail(raw: unknown, paths: string[], reason?: string): string | undefined {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const key = ["command", "url", "query"].find((k) => typeof input[k] === "string");
  const what = key ? (input[key] as string) : paths.join("\n");
  return [what, reason].filter(Boolean).join("\n\n") || undefined;
}
