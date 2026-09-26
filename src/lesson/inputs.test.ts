import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { inputsChangedAt, madeFrom, madeFromFile, outputCurrent, SCENE_IMAGE_FIELDS, scriptImages, seenImage } from "./inputs.js";
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

  it("with the project folder of an agent's script, leaves out images outside it, never looking them up", () => {
    const dir = mkdtempSync(join(tmpdir(), "inputs-"));
    const s = script([
      { type: "image", voice: "Ảnh.", src: "../sources/a.jpg" },
      { type: "image", voice: "Ảnh.", src: "../../elsewhere/b.jpg" },
      { type: "image", voice: "Ảnh.", src: join(tmpdir(), "c.jpg") },
    ]);
    const file = join(dir, "short", "script.json");
    expect(scriptImages(s, file, dir)).toEqual([join(dir, "sources", "a.jpg")]);
    // without one (a script of the user's, in a terminal), every local image counts
    expect(scriptImages(s, file)).toHaveLength(3);
    // a network path (Windows): outside the project, so never looked up
    if (process.platform === "win32") expect(scriptImages(script([{ type: "image", voice: "Ảnh.", src: "\\\\host\\share\\d.jpg" }]), file, dir)).toEqual([]);

    // a record names an image outside the project (the agent can write the record too): never looked up, never current
    mkdirSync(join(dir, "short", "portrait"), { recursive: true });
    const text = JSON.stringify(s);
    writeFileSync(file, text);
    const storyboard = join(dir, "short", "portrait", "storyboard.jpg");
    writeFileSync(storyboard, "");
    writeFileSync(madeFromFile(storyboard), JSON.stringify({ ...madeFrom(text), images: { "../../elsewhere/b.jpg": Infinity } }));
    expect(outputCurrent(storyboard, file, dir)).toBe(false);
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
  /** When a file last changed, as the run takes it when it reads the file. */
  const changedAt = (path: string) => Math.max(statSync(path).mtimeMs, statSync(path).ctimeMs);

  /**
   * A script with two photos, and a format folder with a storyboard made from
   * them: its record, unless `withRecord` is false, has each photo as it is now.
   */
  function made(withRecord = true) {
    const dir = mkdtempSync(join(tmpdir(), "made-"));
    const file = join(dir, "script.json");
    mkdirSync(join(dir, "sources"));
    mkdirSync(join(dir, "portrait"));
    const photo = join(dir, "sources", "photo.jpg");
    const other = join(dir, "sources", "other.jpg");
    writeFileSync(photo, "photo");
    writeFileSync(other, "other");
    const scenes = [
      { type: "image", voice: "Ảnh.", src: "sources/photo.jpg" },
      { type: "image", voice: "Ảnh khác.", src: "sources/other.jpg" },
    ];
    const text = JSON.stringify({ version: "2.0", lesson: { title: "Tin" }, chapters: [{ title: "Tin", scenes }] });
    writeFileSync(file, text);
    const storyboard = join(dir, "portrait", "storyboard.jpg");
    writeFileSync(storyboard, "");
    const record = madeFrom(text);
    for (const image of [photo, other]) seenImage(record, file, image, changedAt(image));
    if (withRecord) writeFileSync(madeFromFile(storyboard), JSON.stringify(record));
    return { dir, file, photo, other, storyboard, text, record };
  }

  it("keeps its record beside it, each image by its path from the script's folder", () => {
    expect(madeFromFile(join("a", "portrait", "storyboard.jpg"))).toBe(join("a", "portrait", "storyboard.inputs.json"));
    const { record, photo } = made();
    expect(record.images).toEqual({ "sources/photo.jpg": changedAt(photo), "sources/other.jpg": expect.any(Number) });
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

  it("takes each image as the run read it: one put in place before the read, even one missing when the run started, is what it shows", () => {
    const { file, photo, storyboard, text } = made();
    // replaced during the narration: the composition reads the new photo
    writeFileSync(photo, "another photo");
    const later = new Date(Date.now() + 60_000);
    utimesSync(photo, later, later);
    const record = madeFrom(text);
    seenImage(record, file, photo, changedAt(photo));
    writeFileSync(madeFromFile(storyboard), JSON.stringify(record));
    expect(outputCurrent(storyboard, file)).toBe(true);
  });

  it("tells each image apart: one read in a late version does not hide another changed after it was read", () => {
    const { file, photo, other, storyboard, text } = made();
    // the composition reads the photo, then the other photo, which had just changed (at +20 s)
    const record = madeFrom(text);
    seenImage(record, file, photo, changedAt(photo));
    utimesSync(other, new Date(Date.now() + 20_000), new Date(Date.now() + 20_000));
    seenImage(record, file, other, changedAt(other));
    writeFileSync(madeFromFile(storyboard), JSON.stringify(record));
    expect(outputCurrent(storyboard, file)).toBe(true);
    // then the photo is replaced (at +15 s): the storyboard shows the old one, though no image is newer than +20 s
    writeFileSync(photo, "another photo");
    utimesSync(photo, new Date(Date.now() + 15_000), new Date(Date.now() + 15_000));
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
