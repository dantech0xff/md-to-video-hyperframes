/**
 * The engine host's service against the real engine, built in the repo root
 * (npm run build there first, as CI does).
 */
import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LessonRunOptions } from "../../../dist/studio/engine.js";
import type { FormatName } from "../shared/types";
import type { HostEvent } from "./protocol";
import { createHostService, loadEngine, storyboardCurrent } from "./service";

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
    expect(info.chromeBuild).toBe("131.0.6778.85");
    // a second init keeps the running engine
    expect((await service.handle("init", { engineRoot: ENGINE })).studioUrl).toBe(info.studioUrl);
  });

  it("checks scripts and reports their formats", async () => {
    const ok = await service.handle("checkScript", { dir: await project(), script: "script.json" });
    expect(ok).toEqual({ ok: true, errors: [], formats: ["portrait"], inputsAt: expect.any(Number) });
    const bad = await service.handle("checkScript", { dir: await project((s) => (s.style = "neon")), script: "script.json" });
    expect(bad.ok).toBe(false);
    expect(bad.formats).toEqual(["portrait"]);
    expect(bad.errors[0]).toMatchObject({ path: "style" });
    const outside = await service.handle("checkScript", { dir: await project(), script: "../script.json" });
    expect(outside.errors[0].message).toMatch(/outside the project folder/);
  });

  it("says when the script or an image it shows last changed", async () => {
    const dir = await project((s) => (s.chapters as { scenes: unknown[] }[])[0].scenes.push({ id: "photo", type: "image", voice: "Ảnh.", src: "sources/photo.jpg" }));
    await mkdir(join(dir, "sources"));
    await writeFile(join(dir, "sources", "photo.jpg"), "photo");
    const past = new Date(Date.now() - 3_600_000);
    await utimes(join(dir, "script.json"), past, past);
    const check = await service.handle("checkScript", { dir, script: "script.json" });
    expect(check.ok).toBe(true);
    // the photo came after the script
    expect(check.inputsAt).toBeGreaterThan(past.getTime() + 60_000);
  });

  it("lists the scenes to review", async () => {
    const review = await service.handle("review", { dir: await project(), script: "script.json", format: "portrait" });
    expect(review.scenes[0]).toMatchObject({ key: "hook", kind: "scene" });
    expect(review.stale).toBe(false);
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
    expect(res).toEqual({ path: undefined, build: "131.0.6778.85" });
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

describe("storyboardCurrent", () => {
  it("tells a reviewed storyboard from a missing or outdated one, so the render captures it again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "storyboard-"));
    const script = join(dir, "script.json");
    await writeFile(script, "{}");
    const now = Date.now();
    expect(storyboardCurrent(script, "portrait", now)).toBe(false);
    await mkdir(join(dir, "portrait"));
    await writeFile(join(dir, "portrait", "storyboard.jpg"), "");
    const later = new Date(now + 60_000);
    await utimes(join(dir, "portrait", "storyboard.jpg"), later, later);
    expect(storyboardCurrent(script, "portrait", now)).toBe(true);
    // the script, or an image it shows, changed after the storyboard was captured
    expect(storyboardCurrent(script, "portrait", now + 120_000)).toBe(false);
    // an input is missing
    expect(storyboardCurrent(script, "portrait", Infinity)).toBe(false);
  });
});
