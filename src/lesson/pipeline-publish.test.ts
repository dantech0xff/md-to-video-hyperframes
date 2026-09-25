/**
 * A full render is built beside the format's folder and moved in once its
 * video is done. No narration and a stand-in HyperFrames CLI: FFmpeg only.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLessonPipeline } from "./pipeline.js";

const EXAMPLE = "examples/lessons/short-launch-vs-async/script.json";
const LAST_RENDER = { "video.mp4": "last good video", "audio.mp3": "its audio", "captions.srt": "its captions", "chapters.txt": "its chapters" };
const run = { silent: true, noStoryboard: true, quality: "draft" } as const;

describe("full render", () => {
  let dir: string;
  const saved = process.env.HYPERFRAMES_CLI;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lesson-publish-"));
    // stands in for the HyperFrames CLI: writes the video, then fails when asked to
    await writeFile(
      join(dir, "cli.mjs"),
      [
        "const out = process.argv[process.argv.indexOf('--output') + 1];",
        "const { writeFileSync } = await import('node:fs');",
        "writeFileSync(out, 'new video');",
        "if (process.env.FAKE_RENDER_FAILS === '1') process.exit(2);",
      ].join("\n"),
    );
    process.env.HYPERFRAMES_CLI = join(dir, "cli.mjs");
  });

  afterEach(() => {
    delete process.env.FAKE_RENDER_FAILS;
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.HYPERFRAMES_CLI;
    else process.env.HYPERFRAMES_CLI = saved;
  });

  /** A lesson rendered before: its video and the files made with it. */
  async function renderedBefore(): Promise<string> {
    const project = await mkdtemp(join(dir, "lesson-"));
    await writeFile(join(project, "script.json"), await readFile(EXAMPLE, "utf8"));
    await mkdir(join(project, "portrait"));
    for (const [name, text] of Object.entries(LAST_RENDER)) await writeFile(join(project, "portrait", name), text);
    return project;
  }

  it("replaces the video and the files made with it together", async () => {
    const project = await renderedBefore();
    const res = await runLessonPipeline(join(project, "script.json"), run);
    expect(res.outputs).toMatchObject([{ format: "portrait", dir: join(project, "portrait"), video: join(project, "portrait", "video.mp4") }]);
    expect(await readFile(join(project, "portrait", "video.mp4"), "utf8")).toBe("new video");
    expect(await readFile(join(project, "portrait", "chapters.txt"), "utf8")).toMatch(/^00:00 /);
    expect((await readFile(join(project, "portrait", "audio.mp3"))).length).toBeGreaterThan(1000);
    expect(existsSync(join(project, ".rendering-portrait"))).toBe(false);
  }, 60_000);

  it("leaves the last good video with the files made with it when the render fails", async () => {
    const project = await renderedBefore();
    process.env.FAKE_RENDER_FAILS = "1";
    await expect(runLessonPipeline(join(project, "script.json"), run)).rejects.toThrow(/exit code 2/);
    for (const [name, text] of Object.entries(LAST_RENDER)) expect(await readFile(join(project, "portrait", name), "utf8")).toBe(text);
    // nothing of the failed attempt is left, next to the video or in its build folder
    expect(existsSync(join(project, "portrait", "index.html"))).toBe(false);
    expect(existsSync(join(project, ".rendering-portrait"))).toBe(false);
  }, 60_000);
});
