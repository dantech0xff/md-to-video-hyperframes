import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";
import { keepsStoryboard, runLessonPipeline } from "./pipeline.js";
import type { LessonEvent } from "./events.js";

const EXAMPLE = "examples/lessons/short-launch-vs-async/script.json";

/** The example Short with `{wait}` dropped from the narration its code beat points at. */
async function lessonWithMissingCue(edit?: (script: { formats: string[] }) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lesson-events-"));
  const script = JSON.parse(await readFile(EXAMPLE, "utf8"));
  const scene = script.chapters[0].scenes.find((s: { id: string }) => s.id === "parallel");
  scene.voice = scene.voice.replace("{wait}", "");
  edit?.(script);
  const path = join(dir, "script.json");
  await writeFile(path, JSON.stringify(script));
  return path;
}

// layout-only runs: no TTS, no audio, no Chrome — just the plan, composition and exports
const layoutOnly = { frames: true, noStoryboard: true } as const;

// a layout-only run takes a fraction of a second, but past 5 s on a busy Windows CI runner
describe("lesson pipeline events", { timeout: 30_000 }, () => {
  it("reports steps, coded warnings and the files it wrote", async () => {
    const events: LessonEvent[] = [];
    await runLessonPipeline(await lessonWithMissingCue(), { ...layoutOnly, onEvent: (e) => events.push(e) });

    expect(events.find((e) => e.type === "step")).toMatchObject({ n: 1, total: 4 });
    const warning = events.find((e) => e.type === "warning");
    expect(warning).toMatchObject({ code: "unknown-cue", scene: "parallel", format: "portrait" });
    expect(warning && "message" in warning && warning.message).toMatch(/^scene parallel: beats reference unknown cue\(s\): wait/);

    const outputs = events.filter((e): e is Extract<LessonEvent, { type: "output" }> => e.type === "output");
    expect(outputs.map((o) => o.kind).sort()).toEqual(["captions", "chapters", "script"]);
    for (const o of outputs) {
      expect(o.format).toBe("portrait");
      expect(existsSync(o.path)).toBe(true);
    }
  });

  it("says first which formats it makes, from the script as it read it", async () => {
    const events: LessonEvent[] = [];
    const script = await lessonWithMissingCue((s) => (s.formats = ["landscape", "portrait"]));
    await runLessonPipeline(script, { ...layoutOnly, onEvent: (e) => events.push(e) });
    expect(events[0]).toEqual({ type: "plan", formats: ["landscape", "portrait"] });
    const made = events.flatMap((e) => (e.type === "output" && e.kind === "script" ? [e.format] : []));
    expect(made.sort()).toEqual(["landscape", "portrait"]);
    // a caller that names the formats gets those
    const only: LessonEvent[] = [];
    await runLessonPipeline(script, { ...layoutOnly, formats: ["portrait"], onEvent: (e) => only.push(e) });
    expect(only[0]).toEqual({ type: "plan", formats: ["portrait"] });
  });

  it("uses an injected config instead of the environment", async () => {
    const events: LessonEvent[] = [];
    const config = { ...loadConfig(), edgeTtsVoice: "vi-VN-NamMinhNeural" };
    await runLessonPipeline(await lessonWithMissingCue(), { ...layoutOnly, config, onEvent: (e) => events.push(e) });
    const first = events.find((e) => e.type === "info");
    expect(first && "message" in first && first.message).toContain("(vi-VN-NamMinhNeural)");
  });

  it("does not start when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("cancelled"));
    await expect(runLessonPipeline(EXAMPLE, { ...layoutOnly, signal: ac.signal })).rejects.toThrow("cancelled");
  });

  it("takes a lexicon by id only when an agent wrote the script", async () => {
    const script = await lessonWithMissingCue((s) => Object.assign(s, { voice: { lexicon: "../../package.json" } }));
    await expect(runLessonPipeline(script, { ...layoutOnly, assetRoot: dirname(script) })).rejects.toThrow(/voice\.lexicon "\.\.\/\.\.\/package\.json": name a bundled lexicon/);
  });

  it("keeps running when a listener throws", async () => {
    const res = await runLessonPipeline(await lessonWithMissingCue(), {
      ...layoutOnly,
      onEvent: () => {
        throw new Error("listener bug");
      },
    });
    expect(res.outputs).toHaveLength(1);
  });
});

describe("keepsStoryboard", () => {
  it("keeps the storyboards of all formats, or of the ones listed", () => {
    expect(keepsStoryboard(true, "portrait")).toBe(true);
    expect(keepsStoryboard(["portrait"], "portrait")).toBe(true);
    // a reviewed Short keeps its storyboard while the lesson's missing one is captured
    expect(keepsStoryboard(["portrait"], "landscape")).toBe(false);
    expect(keepsStoryboard(undefined, "landscape")).toBe(false);
    expect(keepsStoryboard(false, "portrait")).toBe(false);
  });
});
