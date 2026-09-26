import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { madeFrom, madeFromFile } from "../lesson/inputs.js";
import { LessonScriptSchema } from "../lesson/schema.js";
import { storyboardReview } from "./review.js";

const EXAMPLE = "examples/lessons/short-launch-vs-async/script.json";

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "review-"));
  await writeFile(join(dir, "script.json"), await readFile(EXAMPLE, "utf8"));
  return dir;
}

describe("storyboardReview", () => {
  it("lists the scenes from the script before a storyboard exists", async () => {
    const dir = await project();
    const review = await storyboardReview(join(dir, "script.json"), "portrait");
    expect(review.storyboard).toBeUndefined();
    expect(review.stale).toBe(false);
    expect(review.scenes[0]).toMatchObject({ index: 0, key: "hook", kind: "scene", type: "title", chapter: "launch hay async?" });
    expect(review.scenes[0].voice).toMatch(/^Gọi hai API trong coroutine/);
    expect(review.scenes[0].shot).toBeUndefined();
    // cue markers are not read aloud
    const diff = review.scenes.find((s) => s.key === "diff")!;
    expect(diff.voice).not.toMatch(/[{}]/);
    expect(diff.voice).toMatch(/^launch trả về một Job/);
  });

  it("pairs every captured scene with its frame, timing and narration", async () => {
    const dir = await project();
    const out = join(dir, "portrait");
    await mkdir(join(out, "storyboard"), { recursive: true });
    const plan = {
      duration: 12.5,
      scenes: [
        { key: "hook", kind: "scene", type: "title", start: 0, end: 6 },
        { key: "diff", kind: "scene", type: "compare", start: 6, end: 12.5 },
      ],
    };
    await writeFile(join(out, "plan.json"), JSON.stringify(plan));
    await writeFile(join(out, "storyboard", "shot-001.png"), "");
    await writeFile(join(out, "storyboard.jpg"), "");

    const review = await storyboardReview(join(dir, "script.json"), "portrait");
    expect(review).toMatchObject({ format: "portrait", duration: 12.5, storyboard: join(out, "storyboard.jpg"), stale: false });
    expect(review.scenes.slice(0, 2).map((s) => [s.key, s.start, s.end])).toEqual([
      ["hook", 0, 6],
      ["diff", 6, 12.5],
    ]);
    expect(review.scenes[0].shot).toBe(join(out, "storyboard", "shot-001.png"));
    // a frame that was not captured is simply missing
    expect(review.scenes[1].shot).toBeUndefined();
    expect(review.scenes[1].voice).toMatch(/^launch trả về một Job/);
  });

  it("lists the scenes the script has now: one added after the capture has no frame yet, one removed is gone", async () => {
    const dir = await project();
    const script = JSON.parse(await readFile(join(dir, "script.json"), "utf8"));
    const scenes = script.chapters[0].scenes;
    // the video's parts before the agent's change, as the storyboard shows them
    const keys = (await storyboardReview(join(dir, "script.json"), "portrait")).scenes.map((s) => s.key);
    const out = join(dir, "portrait");
    await mkdir(join(out, "storyboard"), { recursive: true });
    // captured from the script as it was, with a scene it no longer has
    const plan = { duration: 9, scenes: [...keys, "gone"].map((key, i) => ({ key, kind: "scene", type: "title", start: i, end: i + 1 })) };
    await writeFile(join(out, "plan.json"), JSON.stringify(plan));
    await writeFile(join(out, "storyboard.jpg"), "");
    const read = await readFile(join(dir, "script.json"), "utf8");
    await writeFile(madeFromFile(join(out, "storyboard.jpg")), JSON.stringify(madeFrom(read, LessonScriptSchema.parse(JSON.parse(read)), join(dir, "script.json"))));
    for (let i = 1; i <= plan.scenes.length; i++) await writeFile(join(out, "storyboard", `shot-${String(i).padStart(3, "0")}.png`), "");
    // then the agent put a new scene second
    scenes.splice(1, 0, { id: "quiz2", type: "statement", voice: "Câu hỏi mới.", text: "Mới" });
    await writeFile(join(dir, "script.json"), JSON.stringify(script));

    const review = await storyboardReview(join(dir, "script.json"), "portrait");
    expect(review.stale).toBe(true);
    expect(review.scenes.map((s) => s.key)).toEqual([keys[0], "quiz2", ...keys.slice(1)]);
    expect(review.scenes[1]).toMatchObject({ index: 1, key: "quiz2", type: "statement", voice: "Câu hỏi mới.", start: undefined, shot: undefined });
    // the others keep the frame they were captured with, by key
    expect(review.scenes[2]).toMatchObject({ key: keys[1], start: 1, end: 2, shot: join(out, "storyboard", "shot-002.png") });
  });

  it("calls a storyboard made from another text of the script out of date, though it was written after it", async () => {
    const dir = await project();
    const file = join(dir, "script.json");
    const read = await readFile(file, "utf8");
    const out = join(dir, "portrait");
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "plan.json"), JSON.stringify({ duration: 1, scenes: [] }));
    await writeFile(join(out, "storyboard.jpg"), "");
    await writeFile(madeFromFile(join(out, "storyboard.jpg")), JSON.stringify(madeFrom(read, LessonScriptSchema.parse(JSON.parse(read)), file)));
    expect((await storyboardReview(file, "portrait")).stale).toBe(false);
    // the agent edited the script while the storyboard was captured from what the run had read
    const past = new Date(Date.now() - 60_000);
    await writeFile(file, read.replace("Gọi hai API", "Gọi ba API"));
    await utimes(file, past, past);
    expect((await storyboardReview(file, "portrait")).stale).toBe(true);
  });

  it("flags a storyboard older than the script", async () => {
    const dir = await project();
    const out = join(dir, "portrait");
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "plan.json"), JSON.stringify({ duration: 1, scenes: [] }));
    await writeFile(join(out, "storyboard.jpg"), "");
    const past = new Date(Date.now() - 60_000);
    await utimes(join(out, "storyboard.jpg"), past, past);
    expect((await storyboardReview(join(dir, "script.json"), "portrait")).stale).toBe(true);
  });

  it("flags a storyboard older than an image the script shows, the script unchanged", async () => {
    const dir = await project();
    const script = JSON.parse(await readFile(join(dir, "script.json"), "utf8"));
    script.chapters[0].scenes.push({ id: "photo", type: "image", voice: "Ảnh.", src: "sources/photo.jpg" });
    await writeFile(join(dir, "script.json"), JSON.stringify(script));
    await mkdir(join(dir, "sources"));
    await writeFile(join(dir, "sources", "photo.jpg"), "photo");
    const out = join(dir, "portrait");
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "plan.json"), JSON.stringify({ duration: 1, scenes: [] }));
    await writeFile(join(out, "storyboard.jpg"), "");
    // captured after the script and the photo were written
    const later = new Date(Date.now() + 60_000);
    await utimes(join(out, "storyboard.jpg"), later, later);
    expect((await storyboardReview(join(dir, "script.json"), "portrait")).stale).toBe(false);
    // the user puts another photo in its place, keeping the script: the photo counts from when it was replaced
    const past = new Date(Date.now() - 60_000);
    await utimes(join(dir, "script.json"), past, past);
    await utimes(join(out, "storyboard.jpg"), past, past);
    await writeFile(join(dir, "sources", "photo.jpg"), "another photo");
    await utimes(join(dir, "sources", "photo.jpg"), past, past);
    expect((await storyboardReview(join(dir, "script.json"), "portrait")).stale).toBe(true);
  });
});
