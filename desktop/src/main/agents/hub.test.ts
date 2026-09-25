import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import type { ActivityEntry, ActivityEvent } from "../../shared/types";
import { ProjectStore } from "../projects";
import { AcpClient } from "./acp";
import { AgentHub } from "./hub";

/** Writes of the activity log, slowed down and counted while `on`, to see saves that overlap. */
const logWrites = vi.hoisted(() => ({ on: false, inFlight: 0, most: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      if (!logWrites.on || !String(args[0]).includes("activity.json")) return fs.writeFile(...args);
      logWrites.most = Math.max(logWrites.most, ++logWrites.inFlight);
      try {
        await new Promise((r) => setTimeout(r, 20));
        return await fs.writeFile(...args);
      } finally {
        logWrites.inFlight--;
      }
    },
  };
});

type PromptScript = (ctx: { sessionId: string; client: acp.AgentContext; cancelled: () => boolean; text: string }) => Promise<acp.StopReason>;

/** An in-process ACP agent whose prompt turns follow `script`. */
function fakeAgent(opts: { script: PromptScript; resume?: boolean; failNew?: acp.RequestError; holdNew?: () => Promise<void> }) {
  const calls: { method: string; params: unknown }[] = [];
  let cancelled = false;
  const make = () =>
    acp
      .agent({ name: "fake" })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true },
          sessionCapabilities: opts.resume === false ? {} : { resume: {} },
        },
      }))
      .onRequest(acp.methods.agent.session.new, async ({ params }) => {
        calls.push({ method: "session/new", params });
        if (opts.failNew) throw opts.failNew;
        await opts.holdNew?.();
        return { sessionId: `s${calls.filter((c) => c.method === "session/new").length}` };
      })
      .onRequest(acp.methods.agent.session.resume, ({ params }) => {
        calls.push({ method: "session/resume", params });
        if (params.sessionId === "gone") throw acp.RequestError.resourceNotFound(params.sessionId);
        return {};
      })
      .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
        calls.push({ method: "session/prompt", params });
        cancelled = false;
        const text = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
        return { stopReason: await opts.script({ sessionId: params.sessionId, client, cancelled: () => cancelled, text }) };
      })
      .onNotification(acp.methods.agent.session.cancel, () => {
        calls.push({ method: "session/cancel", params: {} });
        cancelled = true;
      });
  return { calls, connect: () => new AcpClient(make()) };
}

const say = (client: acp.AgentContext, sessionId: string, update: acp.SessionUpdate) =>
  client.notify(acp.methods.client.session.update, { sessionId, update });

const OPTIONS: acp.PermissionOption[] = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always allow", kind: "allow_always" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

async function setup(agent: ReturnType<typeof fakeAgent>) {
  const root = await mkdtemp(join(tmpdir(), "hub-"));
  const skills = join(root, "_skills");
  await mkdir(join(skills, "create-lesson-video"), { recursive: true });
  await writeFile(join(skills, "create-lesson-video", "SKILL.md"), "# skill\n");
  const projects = new ProjectStore({ root: () => join(root, "projects"), skillsDir: skills });
  const id = await projects.create(
    { title: "Kotlin Flow", kind: "lesson", notes: "", style: "", voice: "free", files: [], urls: [], text: "" },
    async () => [],
  );
  const events: ActivityEvent[] = [];
  const studio = vi.fn(async () => ({ url: "http://127.0.0.1:1234/mcp", token: "tok" }));
  const deps = {
    version: "0.1.0",
    projects,
    studio,
    launch: async (_agent: string, cwd: string) => ({ command: "unused", args: [], env: {}, cwd }),
    emit: (e: ActivityEvent) => events.push(e),
    connect: agent.connect,
  };
  const hub = new AgentHub(deps);
  const idle = () =>
    vi.waitFor(() => {
      const last = events.filter((e) => e.type === "state").at(-1);
      expect(last && last.type === "state" && ["idle", "error"].includes(last.state)).toBe(true);
    }, WAIT);
  return { root, projects, id, dir: projects.dir(id), hub, events, deps, studio, idle };
}

const kinds = (entries: ActivityEntry[]) => entries.map((e) => e.kind);

/** Waits for the agent side; generous, since CI runners can be much slower than a laptop. */
const WAIT = { timeout: 10_000, interval: 20 };

describe("AgentHub", () => {
  let agent: ReturnType<typeof fakeAgent>;

  beforeEach(() => {
    agent = fakeAgent({
      script: async ({ sessionId, client }) => {
        await say(client, sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Mình đọc " } });
        await say(client, sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "tư liệu." } });
        await say(client, sessionId, { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read sources/a.md", kind: "read", status: "pending" });
        await say(client, sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
        await say(client, sessionId, {
          sessionUpdate: "plan",
          entries: [{ content: "Viết script.json", priority: "high", status: "in_progress" }],
        });
        await say(client, sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Xong." } });
        return "end_turn";
      },
    });
  });

  it("opens a session on the project with its Studio tools and logs the turn", async () => {
    const t = await setup(agent);
    await t.hub.send(t.id, "Bắt đầu");
    await t.idle();

    const newSession = agent.calls.find((c) => c.method === "session/new")!.params as acp.NewSessionRequest;
    expect(newSession.cwd).toBe(t.dir);
    expect(newSession.mcpServers).toEqual([
      { type: "http", name: "getframes", url: "http://127.0.0.1:1234/mcp", headers: [{ name: "Authorization", value: "Bearer tok" }] },
    ]);
    expect(t.studio).toHaveBeenCalledWith(t.dir);

    const { entries, state } = await t.hub.activity(t.id);
    expect(state).toBe("idle");
    expect(kinds(entries)).toEqual(["user", "message", "tool", "plan", "message", "end"]);
    // streamed chunks of one message become one entry
    expect(entries[1]).toMatchObject({ kind: "message", text: "Mình đọc tư liệu." });
    expect(entries[2]).toMatchObject({ kind: "tool", title: "Read sources/a.md", status: "done", toolKind: "read" });
    expect(entries[3]).toMatchObject({ kind: "plan", steps: [{ title: "Viết script.json", status: "in_progress" }] });
    expect(entries[5]).toMatchObject({ kind: "end", reason: "done" });

    // the session id is kept for next time, the log is on disk once the turn's end is saved
    expect((await t.projects.read(t.id)).agent.sessionId).toBe("s1");
    const saved = async () => JSON.parse(await readFile(join(t.dir, ".getframes", "activity.json"), "utf8")) as ActivityEntry[];
    await vi.waitFor(async () => expect(kinds(await saved())).toEqual(kinds(entries)), WAIT);
    // the shipped skill and AGENTS.md are in the project
    expect(await readFile(join(t.dir, ".claude", "skills", "create-lesson-video", "SKILL.md"), "utf8")).toBe("# skill\n");
    expect(await readFile(join(t.dir, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  });

  it("answers permissions by the policy and asks the user for the rest", async () => {
    const answers: acp.RequestPermissionOutcome[] = [];
    let dir = "";
    agent = fakeAgent({
      script: async ({ sessionId, client }) => {
        const ask = (toolCall: acp.ToolCallUpdate) => client.request(acp.methods.client.session.requestPermission, { sessionId, toolCall, options: OPTIONS });
        answers.push((await ask({ toolCallId: "e1", title: "Write script.json", kind: "edit", locations: [{ path: join(dir, "script.json") }] })).outcome);
        answers.push((await ask({ toolCallId: "m1", title: "mcp__getframes__build_storyboard", kind: "other", name: "mcp__getframes__build_storyboard" })).outcome);
        answers.push((await ask({ toolCallId: "b1", title: "rm -rf voice", kind: "execute", rawInput: { command: "rm -rf voice" } })).outcome);
        return "end_turn";
      },
    });
    const t = await setup(agent);
    dir = t.dir;
    await t.hub.send(t.id, "Bắt đầu");
    // the shell command waits for the user
    await vi.waitFor(async () => expect((await t.hub.activity(t.id)).state).toBe("waiting"), WAIT);
    const { entries } = await t.hub.activity(t.id);
    const ask = entries.find((e) => e.kind === "permission")!;
    expect(ask).toMatchObject({ kind: "permission", title: "rm -rf voice", detail: "rm -rf voice" });
    t.hub.answer(t.id, ask.id, "reject");
    await t.idle();
    expect(answers).toEqual([
      { outcome: "selected", optionId: "allow" },
      { outcome: "selected", optionId: "allow" },
      { outcome: "selected", optionId: "reject" },
    ]);
    const after = (await t.hub.activity(t.id)).entries;
    expect(after.find((e) => e.id === ask.id)).toMatchObject({ answer: "reject" });
    // requests the app allowed itself stay out of the log
    expect(kinds(after).filter((k) => k === "permission")).toHaveLength(1);
  });

  it("cancels a turn that waits for the user", async () => {
    let outcome: acp.RequestPermissionOutcome | undefined;
    agent = fakeAgent({
      script: async ({ sessionId, client, cancelled }) => {
        outcome = (
          await client.request(acp.methods.client.session.requestPermission, {
            sessionId,
            toolCall: { toolCallId: "b1", title: "npm install", kind: "execute" },
            options: OPTIONS,
          })
        ).outcome;
        return cancelled() ? "cancelled" : "end_turn";
      },
    });
    const t = await setup(agent);
    await t.hub.send(t.id, "Bắt đầu");
    await vi.waitFor(async () => expect((await t.hub.activity(t.id)).state).toBe("waiting"), WAIT);
    await t.hub.cancel(t.id);
    await t.idle();
    expect(outcome).toEqual({ outcome: "cancelled" });
    expect(agent.calls.some((c) => c.method === "session/cancel")).toBe(true);
    const { entries } = await t.hub.activity(t.id);
    expect(entries.at(-1)).toMatchObject({ kind: "end", reason: "cancelled" });
    expect(entries.find((e) => e.kind === "permission")).toMatchObject({ answer: "cancelled" });
  });

  it("stops a turn whose session is still opening, before its message goes out", async () => {
    let open: (() => void) | undefined;
    agent = fakeAgent({ script: async () => "end_turn", holdNew: () => new Promise<void>((r) => (open = r)) });
    const t = await setup(agent);
    await t.hub.send(t.id, "Bắt đầu");
    // Claude Code is still starting when the user presses Stop
    await vi.waitFor(() => expect(open).toBeTypeOf("function"), WAIT);
    await t.hub.cancel(t.id);
    open!();
    await t.idle();
    expect(agent.calls.filter((c) => c.method === "session/prompt")).toEqual([]);
    const { entries, state } = await t.hub.activity(t.id);
    expect(state).toBe("idle");
    expect(entries.at(-1)).toMatchObject({ kind: "end", reason: "cancelled" });

    // the session that opened takes the next message
    await t.hub.send(t.id, "Hai");
    await vi.waitFor(() => expect(agent.calls.filter((c) => c.method === "session/prompt")).toHaveLength(1), WAIT);
    expect(agent.calls.filter((c) => c.method === "session/new")).toHaveLength(1);
  });

  it("refuses a second message while the agent works", async () => {
    let release!: () => void;
    agent = fakeAgent({
      script: async () => {
        await new Promise<void>((r) => (release = r));
        return "end_turn";
      },
    });
    const t = await setup(agent);
    await t.hub.send(t.id, "Một");
    await expect(t.hub.send(t.id, "Hai")).rejects.toThrow(/Agent đang làm việc/);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"), WAIT);
    release();
    await t.idle();
    await t.hub.send(t.id, "Hai");
    await vi.waitFor(() => expect(agent.calls.filter((c) => c.method === "session/prompt")).toHaveLength(2), WAIT);
  });

  it("continues the saved session after a restart, or starts over with a note", async () => {
    const t = await setup(agent);
    await t.hub.send(t.id, "Một");
    await t.idle();

    // the app restarted: a new hub reopens session s1
    const restarted = new AgentHub(t.deps);
    await restarted.send(t.id, "Hai");
    await vi.waitFor(() => expect(agent.calls.filter((c) => c.method === "session/prompt")).toHaveLength(2), WAIT);
    expect(agent.calls.filter((c) => c.method === "session/resume").map((c) => (c.params as acp.ResumeSessionRequest).sessionId)).toEqual(["s1"]);
    expect(agent.calls.filter((c) => c.method === "session/new")).toHaveLength(1);

    // a session the agent no longer knows: a new one, and the agent is told to catch up
    await t.projects.update(t.id, (p) => (p.agent.sessionId = "gone"));
    const again = new AgentHub(t.deps);
    await again.send(t.id, "Ba");
    await vi.waitFor(() => expect(agent.calls.filter((c) => c.method === "session/prompt")).toHaveLength(3), WAIT);
    const last = agent.calls.filter((c) => c.method === "session/prompt").at(-1)!.params as acp.PromptRequest;
    expect(last.prompt[0]).toMatchObject({ type: "text" });
    expect((last.prompt[0] as { text: string }).text).toMatch(/không mở lại được[\s\S]*Ba$/);
    await vi.waitFor(async () => expect((await t.projects.read(t.id)).agent.sessionId).toBe("s2"), WAIT);
  });

  it("reads the saved log once, when the screen and a message ask for it at the same time", async () => {
    const t = await setup(agent);
    await t.hub.send(t.id, "Một");
    await t.idle();
    const saved = async () => JSON.parse(await readFile(join(t.dir, ".getframes", "activity.json"), "utf8")) as ActivityEntry[];
    await vi.waitFor(async () => expect(kinds(await saved())).toContain("end"), WAIT);

    // after a restart the project screen loads the log while the user sends a message
    const restarted = new AgentHub(t.deps);
    const [shown] = await Promise.all([restarted.activity(t.id), restarted.send(t.id, "Hai")]);
    await t.idle();
    const { entries, state } = await restarted.activity(t.id);
    expect(state).toBe("idle");
    expect(entries.filter((e) => e.kind === "user").map((e) => (e as { text: string }).text)).toEqual(["Một", "Hai"]);
    expect(shown.entries).toBe(entries);
  });

  it("saves the log one write at a time, and never leaves half of it", async () => {
    const t = await setup(agent);
    await t.hub.send(t.id, "Một");
    await t.idle();
    // a turn's end, the save timer and quitting can all save at once
    logWrites.on = true;
    try {
      await Promise.all([t.hub.closeAll(), t.hub.closeAll(), t.hub.closeAll()]);
    } finally {
      logWrites.on = false;
    }
    expect(logWrites.most).toBe(1);
    const saved = JSON.parse(await readFile(join(t.dir, ".getframes", "activity.json"), "utf8")) as ActivityEntry[];
    expect(kinds(saved)).toContain("end");
    expect(existsSync(join(t.dir, ".getframes", "activity.json.tmp"))).toBe(false);
  });

  it("takes only an answer the request offered", async () => {
    let outcome: acp.RequestPermissionOutcome | undefined;
    agent = fakeAgent({
      script: async ({ sessionId, client }) => {
        outcome = (
          await client.request(acp.methods.client.session.requestPermission, {
            sessionId,
            toolCall: { toolCallId: "b1", title: "npm install", kind: "execute" },
            options: OPTIONS,
          })
        ).outcome;
        return "end_turn";
      },
    });
    const t = await setup(agent);
    await t.hub.send(t.id, "Bắt đầu");
    await vi.waitFor(async () => expect((await t.hub.activity(t.id)).state).toBe("waiting"), WAIT);
    const ask = (await t.hub.activity(t.id)).entries.find((e) => e.kind === "permission")!;
    expect(() => t.hub.answer(t.id, ask.id, "allow-everything")).toThrow(/không có trong yêu cầu/);
    expect((await t.hub.activity(t.id)).state).toBe("waiting");
    t.hub.answer(t.id, ask.id, "reject");
    await t.idle();
    expect(outcome).toEqual({ outcome: "selected", optionId: "reject" });
  });

  it("ends a start the user stopped as stopped, even when the start then fails", async () => {
    let fail: (() => void) | undefined;
    agent = fakeAgent({ script: async () => "end_turn", holdNew: () => new Promise<void>((_, reject) => (fail = () => reject(new Error("spawn claude ENOENT")))) });
    const t = await setup(agent);
    await t.hub.send(t.id, "Bắt đầu");
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"), WAIT);
    await t.hub.cancel(t.id);
    fail!();
    await t.idle();
    const { entries, state } = await t.hub.activity(t.id);
    expect(state).toBe("idle");
    expect(entries.at(-1)).toMatchObject({ kind: "end", reason: "cancelled" });
    expect(entries.some((e) => e.kind === "notice")).toBe(false);
  });

  it("explains a missing Claude Code login", async () => {
    agent = fakeAgent({ script: async () => "end_turn", failNew: acp.RequestError.authRequired() });
    const t = await setup(agent);
    await t.hub.send(t.id, "Bắt đầu");
    await t.idle();
    const { entries, state } = await t.hub.activity(t.id);
    expect(state).toBe("error");
    expect(entries.find((e) => e.kind === "notice")).toMatchObject({ level: "error", text: expect.stringMatching(/chưa đăng nhập/) });
  });
});
