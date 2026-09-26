import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { inputsChangedAt, madeFrom, madeFromFile, outputCurrent, SCENE_IMAGE_FIELDS, scriptImages } from "./inputs.js";
import { LessonScriptSchema, SceneSchema } from "./schema.js";
import { TYPE_ALIASES } from "./schema-templates.js";

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

  it("knows, for every scene type of the schema, the fields that name an image", () => {
    // the scene types' top-level text fields named like an image, as the renderers pass them to useAsset
    const union = z.toJSONSchema(SceneSchema, { io: "input", unrepresentable: "any" }) as { oneOf: { properties: Record<string, { type?: string; const?: string }> }[] };
    const fromSchema: Record<string, string[]> = {};
    for (const { properties } of union.oneOf) {
      const fields = Object.keys(properties).filter((k) => ["image", "media", "avatar", "src"].includes(k) && properties[k].type === "string");
      if (fields.length) fromSchema[properties.type.const!] = fields;
    }
    expect(SCENE_IMAGE_FIELDS).toEqual(fromSchema);
    // scripts may name a classic scene by its catalog id: none of those shows an image, so the type as written is enough
    for (const target of Object.values(TYPE_ALIASES)) expect(SCENE_IMAGE_FIELDS[target]).toBeUndefined();
  });

  it("leaves out a field a scene type does not have: the engine never shows it", () => {
    const dir = mkdtempSync(join(tmpdir(), "inputs-"));
    const s = LessonScriptSchema.parse({
      version: "2.0",
      lesson: { title: "Tin" },
      chapters: [{ title: "Tin", scenes: [{ type: "statement", voice: "Hết.", text: "Hết", image: "sources/unused.jpg" }] }],
    });
    expect(scriptImages(s, join(dir, "script.json"))).toEqual([]);
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
    const at = inputsChangedAt(file, [photo]);
    expect(at).toBeGreaterThan(past.getTime() + 60_000);
    expect(at).toBe(Math.max(statSync(photo).ctimeMs, statSync(photo).mtimeMs, statSync(file).mtimeMs));
    // a missing image or script: nothing made from them is current
    expect(inputsChangedAt(file, [join(dir, "sources", "gone.jpg")])).toBe(Infinity);
    expect(inputsChangedAt(join(dir, "missing.json"), [])).toBe(Infinity);
  });
});

describe("whether an output shows the script as it is now", () => {
  /** A script with a photo, and a format folder with a storyboard made from them (with its record, unless `record` is false). */
  function made(record = true) {
    const dir = mkdtempSync(join(tmpdir(), "made-"));
    const file = join(dir, "script.json");
    mkdirSync(join(dir, "sources"));
    mkdirSync(join(dir, "portrait"));
    const photo = join(dir, "sources", "photo.jpg");
    writeFileSync(photo, "photo");
    const text = JSON.stringify({ version: "2.0", lesson: { title: "Tin" }, chapters: [{ title: "Tin", scenes: [{ type: "image", voice: "Ảnh.", src: "sources/photo.jpg" }] }] });
    writeFileSync(file, text);
    const storyboard = join(dir, "portrait", "storyboard.jpg");
    writeFileSync(storyboard, "");
    if (record) writeFileSync(madeFromFile(storyboard), JSON.stringify(madeFrom(text, LessonScriptSchema.parse(JSON.parse(text)), file)));
    return { dir, file, photo, storyboard, text };
  }

  it("keeps its record beside it", () => {
    expect(madeFromFile(join("a", "portrait", "storyboard.jpg"))).toBe(join("a", "portrait", "storyboard.inputs.json"));
  });

  it("is current when made from the script's text as it is, whatever the times say", () => {
    const { file, storyboard, text } = made();
    expect(outputCurrent(storyboard, file)).toBe(true);
    // the same text written again, after the storyboard
    const later = new Date(Date.now() + 60_000);
    writeFileSync(file, text);
    utimesSync(file, later, later);
    expect(outputCurrent(storyboard, file)).toBe(true);
  });

  it("is out of date when the script changed after the run read it, though the storyboard was written later", () => {
    const { file, storyboard, text } = made();
    // another program edits the script while the storyboard is captured; the capture ends after it
    const past = new Date(Date.now() - 60_000);
    writeFileSync(file, text.replace("Ảnh.", "Ảnh mới."));
    utimesSync(file, past, past);
    expect(outputCurrent(storyboard, file)).toBe(false);
  });

  it("is out of date when an image it shows changed or went missing", () => {
    const { photo, file, storyboard } = made();
    writeFileSync(photo, "another photo");
    const later = new Date(Date.now() + 60_000);
    utimesSync(photo, later, later);
    expect(outputCurrent(storyboard, file)).toBe(false);
    const again = made();
    rmSync(again.photo);
    expect(outputCurrent(again.storyboard, again.file)).toBe(false);
  });

  it("counts by time without a record, and is never current when missing", () => {
    const { file, storyboard, dir } = made(false);
    const later = new Date(Date.now() + 60_000);
    utimesSync(storyboard, later, later);
    expect(outputCurrent(storyboard, file)).toBe(true);
    const past = new Date(Date.now() - 60_000);
    utimesSync(storyboard, past, past);
    expect(outputCurrent(storyboard, file)).toBe(false);
    // a script that does not parse: its own time
    writeFileSync(file, "{");
    utimesSync(file, past, past);
    utimesSync(storyboard, later, later);
    expect(outputCurrent(storyboard, file)).toBe(true);
    expect(outputCurrent(join(dir, "landscape", "storyboard.jpg"), file)).toBe(false);
  });
});
