import { describe, it, expect, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RenderJob } from "../shared/types";
import { ProjectStore } from "./projects";
import { RenderQueue } from "./render";

async function setup(checks: Record<string, { ok: boolean; formats: ("landscape" | "portrait")[] }>) {
  const root = await mkdtemp(join(tmpdir(), "render-"));
  await mkdir(join(root, "skills"));
  const projects = new ProjectStore({ root: () => join(root, "projects"), skillsDir: join(root, "skills") });
  const id = await projects.create({ title: "Repository pattern", kind: "lesson", notes: "", style: "", voice: "free", files: [], urls: [], text: "" }, async () => []);
  // the scripts the agent wrote; the engine's verdict on each is in `checks`
  for (const script of Object.keys(checks)) {
    await mkdir(dirname(join(projects.dir(id), script)), { recursive: true });
    await writeFile(join(projects.dir(id), script), "{}");
  }
  let n = 0;
  const calls: { method: string; params: unknown }[] = [];
  const engine = {
    call: vi.fn(async (method: string, params: { script?: string }) => {
      calls.push({ method, params });
      if (method === "checkScript") {
        const c = checks[params.script!];
        return { ok: c.ok, errors: c.ok ? [] : [{ path: "chapters", message: "Required" }], formats: c.formats };
      }
      if (method === "render") {
        const jobId = `job${++n}`;
        // the host answers after a moment, as a real one does
        await new Promise((r) => setTimeout(r, 5));
        return { jobId };
      }
      return undefined;
    }),
  };
  const emitted: RenderJob[] = [];
  const busy: boolean[] = [];
  const finished: RenderJob[] = [];
  const queue = new RenderQueue({
    engine: engine as never,
    projects,
    emit: (j) => emitted.push({ ...j }),
    onBusy: (b) => busy.push(b),
    onFinished: (j) => finished.push(j),
  });
  return { projects, id, queue, calls, emitted, busy, finished };
}

describe("RenderQueue", () => {
  it("queues every written video in the formats its script asks for", async () => {
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] }, "short/script.json": { ok: true, formats: ["portrait"] } });
    const jobs = await t.queue.start(t.id, { quality: "high" });
    expect(jobs.map((j) => [j.id, j.video, j.formats, j.quality, j.status])).toEqual([
      ["job1", "main", ["landscape"], "high", "queued"],
      ["job2", "short", ["portrait"], "high", "queued"],
    ]);
    const renders = t.calls.filter((c) => c.method === "render").map((c) => c.params);
    expect(renders).toEqual([
      { dir: t.projects.dir(t.id), script: "script.json", formats: ["landscape"], quality: "high" },
      { dir: t.projects.dir(t.id), script: "short/script.json", formats: ["portrait"], quality: "high" },
    ]);
    expect(t.busy.at(-1)).toBe(true);

    // a video already in the queue is not queued twice
    expect(await t.queue.start(t.id, { quality: "high", videos: ["main"] })).toEqual([]);
  });

  it("follows the host's progress to the end", async () => {
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] } });
    await t.queue.start(t.id, { quality: "standard" });
    t.queue.onHostEvent({ type: "render", jobId: "job1", status: "running", format: "landscape", stage: "Capturing frames", percent: 40 });
    expect(t.queue.list()[0]).toMatchObject({ status: "running", format: "landscape", stage: "Capturing frames", percent: 40 });
    t.queue.onHostEvent({ type: "render", jobId: "job1", status: "done", percent: 100, outputs: [{ format: "landscape", video: "/p/landscape/video.mp4" }] });
    expect(t.finished).toHaveLength(1);
    expect(t.queue.list()[0]).toMatchObject({ status: "done", percent: 100, outputs: [{ format: "landscape", video: "/p/landscape/video.mp4" }] });
    expect(t.busy.at(-1)).toBe(false);
  });

  it("keeps the progress that arrived before the job was recorded", async () => {
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] } });
    t.queue.onHostEvent({ type: "render", jobId: "job1", status: "running", percent: 3 });
    await t.queue.start(t.id, { quality: "draft" });
    expect(t.queue.list()).toHaveLength(1);
    expect(t.queue.list()[0]).toMatchObject({ id: "job1", status: "running", percent: 3, projectId: t.id });
  });

  it("refuses a script with errors and a project with nothing written", async () => {
    const broken = await setup({ "script.json": { ok: false, formats: ["landscape"] } });
    await expect(broken.queue.start(broken.id, { quality: "draft" })).rejects.toThrow(/script\.json còn lỗi \(chapters: Required\)/);
    const empty = await setup({});
    await expect(empty.queue.start(empty.id, { quality: "draft" })).rejects.toThrow(/Chưa có kịch bản/);
  });

  it("renders nothing when one video's script does not parse, and leaves out videos not written yet", async () => {
    // a script that fails the schema has no formats: it must not drop out of the batch unnoticed
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] }, "short/script.json": { ok: false, formats: [] } });
    await expect(t.queue.start(t.id, { quality: "draft" })).rejects.toThrow(/Short 9:16: short\/script\.json còn lỗi/);
    expect(t.calls.filter((c) => c.method === "render")).toEqual([]);

    const onlyMain = await setup({ "script.json": { ok: true, formats: ["landscape"] } });
    expect((await onlyMain.queue.start(onlyMain.id, { quality: "draft" })).map((j) => j.video)).toEqual(["main"]);
    await expect(onlyMain.queue.start(onlyMain.id, { quality: "draft", videos: ["short"] })).rejects.toThrow(/Chưa có kịch bản/);
  });

  it("queues a video once when two requests come at the same time", async () => {
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] }, "short/script.json": { ok: true, formats: ["portrait"] } });
    // Render on the main video and Render all, clicked together
    const [one, all] = await Promise.all([t.queue.start(t.id, { quality: "draft", videos: ["main"] }), t.queue.start(t.id, { quality: "draft" })]);
    expect(one.map((j) => j.video)).toEqual(["main"]);
    expect(all.map((j) => j.video)).toEqual(["short"]);
    expect(t.calls.filter((c) => c.method === "render").map((c) => (c.params as { script: string }).script)).toEqual(["script.json", "short/script.json"]);
  });

  it("keeps what a job reported before the host's answer came, and reports its end once", async () => {
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] } });
    t.queue.onHostEvent({ type: "render", jobId: "job1", status: "failed", error: "Chrome crashed" });
    expect(t.finished).toEqual([]);
    const [job] = await t.queue.start(t.id, { quality: "draft" });
    expect(job).toMatchObject({ id: "job1", projectId: t.id, status: "failed", error: "Chrome crashed", finishedAt: expect.any(String) });
    expect(t.finished).toHaveLength(1);
    expect(t.finished[0]).toMatchObject({ id: "job1", projectId: t.id, error: "Chrome crashed" });
    expect(t.busy.at(-1)).toBe(false);
  });

  it("fails what the engine host had when it dies", async () => {
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] } });
    await t.queue.start(t.id, { quality: "draft" });
    t.queue.onHostExit();
    expect(t.queue.list()[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/Engine dừng/) });
    expect(t.busy.at(-1)).toBe(false);
  });

  it("drops the jobs a dead host never answered for", async () => {
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] } });
    await t.queue.start(t.id, { quality: "draft" });
    // the host said a job was queued, then died before answering who asked for it
    t.queue.onHostEvent({ type: "render", jobId: "job-unanswered", status: "queued" });
    t.queue.onHostExit();
    expect(t.queue.list().map((j) => [j.id, j.status])).toEqual([["job1", "failed"]]);
    expect(t.emitted.every((j) => j.projectId === t.id)).toBe(true);
    expect(t.busy.at(-1)).toBe(false);
  });

  it("forgets old finished jobs", async () => {
    const t = await setup({ "script.json": { ok: true, formats: ["landscape"] } });
    for (let i = 0; i < 40; i++) {
      await t.queue.start(t.id, { quality: "draft", videos: ["main"] });
      t.queue.onHostEvent({ type: "render", jobId: `job${i + 1}`, status: "done" });
    }
    expect(t.queue.list().length).toBeLessThanOrEqual(31);
  });
});
