import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inputsChangedAt, scriptImages, scriptInputsChangedAt } from "./inputs.js";
import { LessonScriptSchema } from "./schema.js";

const script = (scenes: Record<string, unknown>[]) =>
  LessonScriptSchema.parse({ version: "2.0", lesson: { title: "Tin nhanh" }, chapters: [{ title: "Tin", scenes }] });

describe("what a script's outputs are made from", () => {
  it("lists the local images the scenes show, relative to the script, without URLs", () => {
    const dir = mkdtempSync(join(tmpdir(), "inputs-"));
    const s = script([
      { type: "news.breaking", voice: "Tin.", headline: "Tin", image: "../sources/a.jpg" },
      { type: "news.quote", voice: "Nói.", quote: "Câu", person: "An", source: "Báo", avatar: "sources/b.png" },
      { type: "news.lower-third", voice: "Ảnh.", media: "https://example.com/c.jpg", tag: "LIVE", name: "An" },
      { type: "image", voice: "Ảnh.", src: "sources/b.png" },
      { type: "statement", voice: "Hết.", text: "Hết" },
    ]);
    expect(scriptImages(s, join(dir, "short", "script.json"))).toEqual([join(dir, "sources", "a.jpg"), join(dir, "short", "sources", "b.png")]);
  });

  it("takes the latest change of the script and its images, a replaced image included", () => {
    const dir = mkdtempSync(join(tmpdir(), "inputs-"));
    const file = join(dir, "script.json");
    mkdirSync(join(dir, "sources"));
    const photo = join(dir, "sources", "photo.jpg");
    writeFileSync(photo, "photo");
    writeFileSync(file, JSON.stringify({ version: "2.0", lesson: { title: "Tin" }, chapters: [{ title: "Tin", scenes: [{ type: "image", voice: "Ảnh.", src: "sources/photo.jpg" }] }] }));
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(file, past, past);
    // copied in with the modification time it had elsewhere: its change time is now
    utimesSync(photo, past, past);
    const at = scriptInputsChangedAt(file);
    expect(at).toBeGreaterThan(past.getTime() + 60_000);
    expect(at).toBe(Math.max(statSync(photo).ctimeMs, statSync(photo).mtimeMs, statSync(file).mtimeMs));
    // a missing image or script: nothing made from them is current
    expect(inputsChangedAt(file, [join(dir, "sources", "gone.jpg")])).toBe(Infinity);
    expect(scriptInputsChangedAt(join(dir, "missing.json"))).toBe(Infinity);
    // a script that does not parse: its own time
    writeFileSync(join(dir, "bad.json"), "{");
    expect(scriptInputsChangedAt(join(dir, "bad.json"))).toBe(statSync(join(dir, "bad.json")).mtimeMs);
  });
});
