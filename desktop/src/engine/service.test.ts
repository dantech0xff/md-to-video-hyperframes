/**
 * The engine host's service against the real engine, built in the repo root
 * (npm run build there first, as CI does).
 */
import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HostEvent } from "./protocol";
import { createHostService } from "./service";

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
    expect(ok).toEqual({ ok: true, errors: [], formats: ["portrait"] });
    const bad = await service.handle("checkScript", { dir: await project((s) => (s.style = "neon")), script: "script.json" });
    expect(bad.ok).toBe(false);
    expect(bad.formats).toEqual(["portrait"]);
    expect(bad.errors[0]).toMatchObject({ path: "style" });
    const outside = await service.handle("checkScript", { dir: await project(), script: "../script.json" });
    expect(outside.errors[0].message).toMatch(/outside the project folder/);
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
    const { jobId } = await service.handle("render", { dir, script: "script.json", formats: ["portrait"], quality: "draft" });
    expect(events.find((e) => e.type === "render" && e.jobId === jobId)).toMatchObject({ status: "queued" });
    await expect.poll(() => events.find((e) => e.type === "render" && e.jobId === jobId && e.status === "failed")).toMatchObject({
      error: expect.stringMatching(/script\.json is invalid/),
    });
    await expect(service.handle("render", { dir, script: "../x.json", formats: ["portrait"], quality: "draft" })).rejects.toThrow(/outside the project/);
  });
});
