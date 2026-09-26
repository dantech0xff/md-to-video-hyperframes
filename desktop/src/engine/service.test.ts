/**
 * The engine host's service against the real engine, built in the repo root
 * (npm run build there first, as CI does).
 */
import { describe, it, expect, afterAll } from "vitest";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LessonRunOptions } from "../../../dist/studio/engine.js";
import type { FormatName } from "../shared/types";
import type { HostEvent } from "./protocol";
import { SCENE_IMAGE_FIELDS, scriptFacts, videoCurrent } from "../main/projects";
import { createHostService, loadEngine } from "./service";

const ENGINE = resolve(__dirname, "..", "..", "..");
const EXAMPLE = join(ENGINE, "examples", "lessons", "short-launch-vs-async", "script.json");
const built = existsSync(join(ENGINE, "dist", "studio", "engine.js"));

describe.skipIf(!built)("engine host service", () => {
  const events: HostEvent[] = [];
  const service = createHostService((e) => events.push(e));
  afterAll(() => service.close());

  async function project(edit?: (s: Record<string, unknown>) => void): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "host-"));
    const script = JSON.parse(await readFile(EXAMPLE, "utf8")) as Record<string, unknown>;
    edit?.(script);
    await writeFile(join(dir, "script.json"), JSON.stringify(script));
    return dir;
  }

  it("loads the engine and starts the Studio tools", async () => {
    const info = await service.handle("init", { engineRoot: ENGINE });
    expect(info.studioUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(info.chromeBuild).toBe("152.0.7977.30");
    // a second init keeps the running engine
    expect((await service.handle("init", { engineRoot: ENGINE })).studioUrl).toBe(info.studioUrl);
  });

  it("checks scripts and reports their formats", async () => {
    const ok = await service.handle("checkScript", { dir: await project(), script: "script.json" });
    expect(ok).toEqual({ ok: true, errors: [], formats: ["portrait"] });
    const bad = await service.handle("checkScript", { dir: await project((s) => (s.style = "neon")), script: "script.json" });
    expect(bad.ok).toBe(false);
    expect(bad.formats).toEqual(["portrait"]);
    expect(bad.errors[0]).toMatchObject({ path: "style" });
    const outside = await service.handle("checkScript", { dir: await project(), script: "../script.json" });
    expect(outside.errors[0].message).toMatch(/outside the project folder/);
  });

  it("counts the same image fields as the project list", async () => {
    // the list tells an outdated video without the engine: it must read the scenes' images the engine reads
    expect(SCENE_IMAGE_FIELDS).toEqual((await loadEngine(ENGINE)).SCENE_IMAGE_FIELDS);
  });

  it("reads a video's record as the engine does", async () => {
    const engine = await loadEngine(ENGINE);
    const dir = await project((s) => (s.chapters as { scenes: unknown[] }[])[0].scenes.push({ id: "photo", type: "image", voice: "Ảnh.", src: "sources/photo.jpg" }));
    await mkdir(join(dir, "sources"));
    const photo = join(dir, "sources", "photo.jpg");
    await writeFile(photo, "photo");
    const script = join(dir, "script.json");
    const video = join(dir, "portrait", "video.mp4");
    await mkdir(join(dir, "portrait"), { recursive: true });
    await writeFile(video, "");
    // a record as the project list understands it (the script's sha256, each photo by its path from the script's folder,
    // when it last changed and which file it is): what the engine takes as its own
    const facts = scriptFacts(script, dir);
    const seen = { changedAt: Math.max(statSync(photo).mtimeMs, statSync(photo).ctimeMs), fileId: String(statSync(photo, { bigint: true }).ino) };
    await writeFile(join(dir, "portrait", "video.inputs.json"), JSON.stringify({ script: facts.scriptHash, images: { "sources/photo.jpg": seen } }));
    const past = new Date(Date.now() - 60_000);
    await utimes(video, past, past);
    expect(engine.outputCurrent(video, script, dir)).toBe(true);
    expect(videoCurrent(video, script, dir, facts)).toBe(true);
    // another file put in the photo's place, with the times it had: neither takes it for the photo read
    await writeFile(join(dir, "sources", "older.jpg"), "older photo");
    await utimes(join(dir, "sources", "older.jpg"), past, past);
    await rename(join(dir, "sources", "older.jpg"), photo);
    expect(String(statSync(photo, { bigint: true }).ino)).not.toBe(seen.fileId);
    expect(engine.outputCurrent(video, script, dir)).toBe(false);
    expect(videoCurrent(video, script, dir, scriptFacts(script, dir))).toBe(false);
    // the record the other way round: both read a record of the file there now as current
    const now = { changedAt: Math.max(statSync(photo).mtimeMs, statSync(photo).ctimeMs), fileId: String(statSync(photo, { bigint: true }).ino) };
    await writeFile(join(dir, "portrait", "video.inputs.json"), JSON.stringify({ script: facts.scriptHash, images: { "sources/photo.jpg": now } }));
    expect(engine.outputCurrent(video, script, dir)).toBe(true);
    expect(videoCurrent(video, script, dir, scriptFacts(script, dir))).toBe(true);
    // the photo replaced
    await writeFile(photo, "another photo");
    const later = new Date(Date.now() + 60_000);
    await utimes(photo, later, later);
    expect(engine.outputCurrent(video, script, dir)).toBe(false);
    expect(videoCurrent(video, script, dir, scriptFacts(script, dir))).toBe(false);
  });

  it("lists the scenes to review", async () => {
    const review = await service.handle("review", { dir: await project(), script: "script.json", format: "portrait" });
    expect(review.scenes[0]).toMatchObject({ key: "hook", kind: "scene" });
    expect(review.stale).toBe(false);
  });

  it("reads a part of the script for the edit form and saves it back", async () => {
    const dir = await project();
    const part = await service.handle("readPart", { dir, script: "script.json", key: "hook" });
    expect(part).toMatchObject({ key: "hook", kind: "scene", type: "title", value: { title: "*launch* hay *async*?" } });
    expect(part.schema.properties.title).toMatchObject({ type: "string", maxLength: 90 });
    const edit = { key: "hook", version: part.version, value: { ...part.value, title: "launch hay *async*?" } };
    expect(await service.handle("savePart", { dir, script: "script.json", edit })).toMatchObject({ ok: true, changed: true });
    expect(JSON.parse(await readFile(join(dir, "script.json"), "utf8")).chapters[0].scenes[0].title).toBe("launch hay *async*?");
    // the version it started from is gone now
    expect(await service.handle("savePart", { dir, script: "script.json", edit })).toMatchObject({ ok: false, conflict: true });
    await expect(service.handle("readPart", { dir, script: "script.json", key: "nope" })).rejects.toThrow(/no scene "nope"/);
  });

  it("refuses to build or render into a folder that is a symbolic link out of the project", async () => {
    const dir = await project();
    // a junction on Windows: a link to a folder that needs no special rights
    await symlink(await mkdtemp(join(tmpdir(), "elsewhere-")), join(dir, "portrait"), "junction");
    await expect(service.handle("storyboard", { dir, script: "script.json", jobId: "sb-link" })).rejects.toThrow(/portrait.*symbolic link/);
    await expect(service.handle("render", { dir, script: "script.json", quality: "draft" })).rejects.toThrow(/portrait.*symbolic link/);
    expect(events.some((e) => e.type === "storyboard" && e.jobId === "sb-link")).toBe(false);
  });

  it("sets the engine environment and describes the catalog with it", async () => {
    await service.handle("setEnv", { env: { VOICE_PROFILE: "clone", ELEVENLABS_API_KEY: null } });
    const catalog = await service.handle("catalog", undefined);
    expect(catalog.voices.default).toBe("clone");
    expect(catalog.voices.clone.available).toBe(false);
    expect(catalog.styles.map((s) => s.id)).toContain("whiteboard");
    await service.handle("setEnv", { env: { VOICE_PROFILE: null } });
    expect((await service.handle("catalog", undefined)).voices.default).toBe("free");
  });

  it("finds no Chrome in an empty download folder without downloading", async () => {
    const res = await service.handle("chrome", { cacheDir: await mkdtemp(join(tmpdir(), "browsers-")), install: false });
    expect(res).toEqual({ path: undefined, build: "152.0.7977.30" });
  });

  it("gives out a token per project", async () => {
    const a = await service.handle("openProject", { dir: await project() });
    const b = await service.handle("openProject", { dir: await project() });
    expect(a.token).not.toBe(b.token);
    await service.handle("closeProject", { token: a.token });
  });

  it("reports a render that fails", async () => {
    const dir = await project((s) => (s.chapters = []));
    const { jobId } = await service.handle("render", { dir, script: "script.json", quality: "draft" });
    expect(events.find((e) => e.type === "render" && e.jobId === jobId)).toMatchObject({ status: "queued" });
    await expect.poll(() => events.find((e) => e.type === "render" && e.jobId === jobId && e.status === "failed"), { timeout: 15_000 }).toMatchObject({
      error: expect.stringMatching(/script\.json is invalid/),
    });
    await expect(service.handle("render", { dir, script: "../x.json", quality: "draft" })).rejects.toThrow(/outside the project/);
  });

  it("renders what the script asks for when the job runs, not what it asked when the job was queued", async () => {
    const seen: HostEvent[] = [];
    const runs: LessonRunOptions[] = [];
    let finishFirst!: () => void;
    const firstHolds = new Promise<void>((r) => (finishFirst = r));
    // the real engine, with a pipeline that reads the script and says what it would render, as the real one does
    const host = createHostService(
      (e) => seen.push(e),
      async (root) => ({
        ...(await loadEngine(root)),
        async runLessonPipeline(scriptPath: string, opts: LessonRunOptions = {}) {
          runs.push(opts);
          if (runs.length === 1) await firstHolds;
          const { formats } = JSON.parse(await readFile(scriptPath, "utf8")) as { formats: FormatName[] };
          opts.onEvent?.({ type: "plan", formats: opts.formats ?? formats });
          return { outputs: [] };
        },
      }),
    );
    try {
      await host.handle("init", { engineRoot: ENGINE });
      await host.handle("render", { dir: await project(), script: "script.json", quality: "draft" });
      const dir = await project();
      const { jobId } = await host.handle("render", { dir, script: "script.json", quality: "draft" });
      // while the job waits its turn, the agent adds a landscape version and captures its storyboard
      const script = JSON.parse(await readFile(join(dir, "script.json"), "utf8")) as Record<string, unknown>;
      await writeFile(join(dir, "script.json"), JSON.stringify({ ...script, formats: ["landscape", "portrait"] }));
      await mkdir(join(dir, "landscape"));
      await writeFile(join(dir, "landscape", "storyboard.jpg"), "");
      const later = new Date(Date.now() + 60_000);
      await utimes(join(dir, "landscape", "storyboard.jpg"), later, later);
      finishFirst();

      await expect.poll(() => seen.some((e) => e.type === "render" && e.jobId === jobId && e.status === "done")).toBe(true);
      expect(runs[1].formats).toBeUndefined();
      // the agent wrote the script: its images come from the project folder only
      expect(runs[1]).toMatchObject({ quality: "draft", noStoryboard: ["landscape"], assetRoot: dir });
      expect(seen.find((e) => e.type === "render" && e.jobId === jobId && e.formats)).toMatchObject({ formats: ["landscape", "portrait"] });
    } finally {
      await host.close();
    }
  });

  it("captures a storyboard again with the video when an image it shows changed after it", async () => {
    const seen: HostEvent[] = [];
    const runs: LessonRunOptions[] = [];
    const host = createHostService(
      (e) => seen.push(e),
      async (root) => ({
        ...(await loadEngine(root)),
        async runLessonPipeline(_scriptPath: string, opts: LessonRunOptions = {}) {
          runs.push(opts);
          return { outputs: [] };
        },
      }),
    );
    const rendered = async (dir: string) => {
      const { jobId } = await host.handle("render", { dir, script: "script.json", quality: "draft" });
      await expect.poll(() => seen.some((e) => e.type === "render" && e.jobId === jobId && e.status === "done")).toBe(true);
      return runs.at(-1)!;
    };
    try {
      await host.handle("init", { engineRoot: ENGINE });
      const dir = await project((s) => (s.chapters as { scenes: unknown[] }[])[0].scenes.push({ id: "photo", type: "image", voice: "Ảnh.", src: "sources/photo.jpg" }));
      await mkdir(join(dir, "sources"));
      await writeFile(join(dir, "sources", "photo.jpg"), "photo");
      await mkdir(join(dir, "portrait"));
      const storyboard = join(dir, "portrait", "storyboard.jpg");
      await writeFile(storyboard, "");
      // reviewed after the script and the photo were written: it stays
      const later = new Date(Date.now() + 60_000);
      await utimes(storyboard, later, later);
      expect((await rendered(dir)).noStoryboard).toEqual(["portrait"]);
      // the user puts another photo in its place, the script unchanged
      const past = new Date(Date.now() - 60_000);
      await utimes(join(dir, "script.json"), past, past);
      await utimes(storyboard, past, past);
      await writeFile(join(dir, "sources", "photo.jpg"), "another photo");
      await utimes(join(dir, "sources", "photo.jpg"), past, past);
      expect((await rendered(dir)).noStoryboard).toEqual([]);
    } finally {
      await host.close();
    }
  });
});

describe.skipIf(!built)("storyboards the app builds", () => {
  it("builds the storyboard with its narration, under the job id the app gave, and says what it is doing", async () => {
    const seen: HostEvent[] = [];
    const runs: { script: string; opts: LessonRunOptions }[] = [];
    const host = createHostService(
      (e) => seen.push(e),
      async (root) => ({
        ...(await loadEngine(root)),
        async runLessonPipeline(scriptPath: string, opts: LessonRunOptions = {}) {
          runs.push({ script: scriptPath, opts });
          opts.onEvent?.({ type: "plan", formats: ["portrait"] });
          opts.onEvent?.({ type: "step", n: 1, total: 4, message: "Narration: 2 segments" });
          opts.onEvent?.({ type: "progress", stage: "narration", percent: 50, detail: "1/2" });
          opts.onEvent?.({ type: "step", n: 2, total: 4, message: "[portrait] 5 scenes · 40.0s", format: "portrait" });
          return { outputs: [] };
        },
      }),
    );
    try {
      await host.handle("init", { engineRoot: ENGINE });
      const dir = await mkdtemp(join(tmpdir(), "host-sb-"));
      await writeFile(join(dir, "script.json"), await readFile(EXAMPLE, "utf8"));
      await host.handle("storyboard", { dir, script: "script.json", jobId: "storyboard-1" });
      await expect.poll(() => seen.at(-1)).toMatchObject({ type: "storyboard", jobId: "storyboard-1", status: "done" });
      expect(runs[0].script).toBe(join(dir, "script.json"));
      // as build_storyboard: the narration and the frames, images from the project folder only
      expect(runs[0].opts).toMatchObject({ storyboardOnly: true, assetRoot: dir });
      expect(runs[0].opts.frames).toBeUndefined();
      expect(seen.map((e) => (e.type === "storyboard" ? [e.status, e.step, e.format, e.percent] : e.type))).toEqual([
        ["queued", undefined, undefined, undefined],
        ["running", "narration", undefined, 0],
        ["running", "narration", undefined, 50],
        ["running", "capture", "portrait", undefined],
        ["done", undefined, undefined, undefined],
      ]);
    } finally {
      await host.close();
    }
  });

  it("stops a build the app cancels", async () => {
    const seen: HostEvent[] = [];
    const host = createHostService(
      (e) => seen.push(e),
      async (root) => ({
        ...(await loadEngine(root)),
        async runLessonPipeline(_script: string, opts: LessonRunOptions = {}) {
          await new Promise((_, reject) => opts.signal?.addEventListener("abort", () => reject(opts.signal?.reason)));
          return { outputs: [] };
        },
      }),
    );
    try {
      await host.handle("init", { engineRoot: ENGINE });
      const dir = await mkdtemp(join(tmpdir(), "host-sb-"));
      await writeFile(join(dir, "script.json"), await readFile(EXAMPLE, "utf8"));
      await host.handle("storyboard", { dir, script: "script.json", jobId: "storyboard-2" });
      await expect.poll(() => seen.some((e) => e.type === "storyboard" && e.status === "running")).toBe(true);
      await host.handle("cancel", { jobId: "storyboard-2" });
      await expect.poll(() => seen.at(-1)).toMatchObject({ type: "storyboard", jobId: "storyboard-2", status: "cancelled" });
    } finally {
      await host.close();
    }
  });
});
