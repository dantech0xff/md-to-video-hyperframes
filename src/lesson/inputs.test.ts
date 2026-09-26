import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { imagesChangedAt, inputsChangedAt, madeFrom, madeFromFile, outputCurrent, SCENE_IMAGE_FIELDS, scriptImages, seenImage, writeMadeFrom, type MadeFrom } from "./inputs.js";
import { LessonScriptSchema, SceneSchema } from "./schema.js";
import { TYPE_ALIASES } from "./schema-templates.js";

const canSymlink = (() => {
  try {
    const d = mkdtempSync(join(tmpdir(), "link-"));
    writeFileSync(join(d, "a"), "");
    symlinkSync(join(d, "a"), join(d, "b"));
    return true;
  } catch {
    return false;
  }
})();

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
    writeFileSync(madeFromFile(storyboard), JSON.stringify({ ...madeFrom(text), images: { "../../elsewhere/b.jpg": { changedAt: 8.64e15, fileId: "1" } } }));
    expect(outputCurrent(storyboard, file, dir)).toBe(false);
  });

  it.skipIf(!canSymlink)("with the project folder, follows no link out of it: such an image counts as missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "inputs-"));
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "photo.jpg"), "photo");
    mkdirSync(join(dir, "sources"));
    symlinkSync(join(outside, "photo.jpg"), join(dir, "sources", "photo.jpg"));
    const photo = join(dir, "sources", "photo.jpg");
    expect(imagesChangedAt([photo], dir)).toBe(Infinity);
    // a script of the user's (no project folder): the link is the user's own
    expect(imagesChangedAt([photo])).toBeLessThan(Infinity);
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
  /** Which file a path leads to, as the run tells it. */
  const fileId = (path: string) => String(statSync(path, { bigint: true }).ino);
  /** The run read `image` as it is now. */
  const read = (record: MadeFrom, file: string, image: string) => seenImage(record, file, image, changedAt(image), fileId(image));

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
    for (const image of [photo, other]) read(record, file, image);
    if (withRecord) writeFileSync(madeFromFile(storyboard), JSON.stringify(record));
    return { dir, file, photo, other, storyboard, text, record };
  }

  it("keeps its record beside it, each image by its path from the script's folder", () => {
    expect(madeFromFile(join("a", "portrait", "storyboard.jpg"))).toBe(join("a", "portrait", "storyboard.inputs.json"));
    const { record, photo } = made();
    expect(record.images).toEqual({ "sources/photo.jpg": { changedAt: changedAt(photo), fileId: fileId(photo) }, "sources/other.jpg": expect.any(Object) });
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
    read(record, file, photo);
    writeFileSync(madeFromFile(storyboard), JSON.stringify(record));
    expect(outputCurrent(storyboard, file)).toBe(true);
  });

  it("tells each image apart: one read in a late version does not hide another changed after it was read", () => {
    const { file, photo, other, storyboard, text } = made();
    // the composition reads the photo, then the other photo, which had just changed (at +20 s)
    const record = madeFrom(text);
    read(record, file, photo);
    utimesSync(other, new Date(Date.now() + 20_000), new Date(Date.now() + 20_000));
    read(record, file, other);
    writeFileSync(madeFromFile(storyboard), JSON.stringify(record));
    expect(outputCurrent(storyboard, file)).toBe(true);
    // then the photo is replaced (at +15 s): the storyboard shows the old one, though no image is newer than +20 s
    writeFileSync(photo, "another photo");
    utimesSync(photo, new Date(Date.now() + 15_000), new Date(Date.now() + 15_000));
    expect(outputCurrent(storyboard, file)).toBe(false);
  });

  it("keeps the earliest version of an image read twice: changed between the reads, the output shows both", () => {
    const { file, photo, storyboard, text } = made();
    // the script spells the photo's path two ways, so the composition reads it twice; it is replaced in between
    const record = madeFrom(text);
    const first = changedAt(photo);
    read(record, file, photo);
    writeFileSync(photo, "another photo");
    utimesSync(photo, new Date(Date.now() + 20_000), new Date(Date.now() + 20_000));
    read(record, file, photo);
    expect(record.images["sources/photo.jpg"]).toEqual({ changedAt: first, fileId: fileId(photo) });
    writeFileSync(madeFromFile(storyboard), JSON.stringify(record));
    // a scene shows the old photo
    expect(outputCurrent(storyboard, file)).toBe(false);
    // a file named like an object's own keys is recorded as any other
    const odd = madeFrom(text);
    for (const name of ["__proto__", "constructor"]) seenImage(odd, file, join(dirname(file), name), 5, "7");
    const seen = { changedAt: 5, fileId: "7" };
    expect(Object.entries(JSON.parse(JSON.stringify(odd)).images)).toEqual([["__proto__", seen], ["constructor", seen]]);
    // two files read under one path: none matches both
    seenImage(odd, file, join(dirname(file), "constructor"), 6, "8");
    expect(odd.images.constructor).toEqual({ changedAt: 5, fileId: "" });
  });

  it("writes an agent's record only inside the project: a folder switched for a link gets nothing", () => {
    const { dir, text } = made();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    // the format folder, switched while the storyboard was captured (a junction on Windows: a link to a folder that needs no special rights)
    rmSync(join(dir, "portrait"), { recursive: true });
    symlinkSync(outside, join(dir, "portrait"), "junction");
    const record = madeFrom(text);
    expect(() => writeMadeFrom(join(dir, "portrait", "storyboard.jpg"), record, dir)).toThrow(/portrait leads outside the project folder through a symbolic link/);
    expect(readdirSync(outside)).toEqual([]);
    // kept beside the output otherwise, and without the project folder (a script of the user's) as it is
    mkdirSync(join(dir, "landscape"));
    writeMadeFrom(join(dir, "landscape", "storyboard.jpg"), record, dir);
    expect(JSON.parse(readFileSync(join(dir, "landscape", "storyboard.inputs.json"), "utf8"))).toEqual(record);
    writeMadeFrom(join(dir, "landscape", "video.mp4"), record);
    expect(readdirSync(join(dir, "landscape")).sort()).toEqual(["storyboard.inputs.json", "video.inputs.json"]);
  });

  it.skipIf(!canSymlink)("is out of date when the image's path leads to another file now, however old: a link switched, a folder swapped", () => {
    const dir = mkdtempSync(join(tmpdir(), "made-"));
    const file = join(dir, "script.json");
    mkdirSync(join(dir, "sources"));
    mkdirSync(join(dir, "portrait"));
    const past = new Date(Date.now() - 3_600_000);
    // the second photo is the older one, its change time too: made first
    writeFileSync(join(dir, "sources", "second.jpg"), "second");
    utimesSync(join(dir, "sources", "second.jpg"), past, past);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    writeFileSync(join(dir, "sources", "first.jpg"), "first");
    const active = join(dir, "sources", "active.jpg");
    symlinkSync(join(dir, "sources", "first.jpg"), active);
    const text = JSON.stringify({ version: "2.0", lesson: { title: "Tin" }, chapters: [{ title: "Tin", scenes: [{ type: "image", voice: "Ảnh.", src: "sources/active.jpg" }] }] });
    writeFileSync(file, text);
    const storyboard = join(dir, "portrait", "storyboard.jpg");
    writeFileSync(storyboard, "");
    const record = madeFrom(text);
    read(record, file, active);
    writeFileSync(madeFromFile(storyboard), JSON.stringify(record));
    expect(outputCurrent(storyboard, file, dir)).toBe(true);
    // the link now leads to the second photo, whose times are all older than the read
    unlinkSync(active);
    symlinkSync(join(dir, "sources", "second.jpg"), active);
    expect(changedAt(active)).toBeLessThan(record.images["sources/active.jpg"].changedAt);
    expect(outputCurrent(storyboard, file, dir)).toBe(false);
    expect(outputCurrent(storyboard, file)).toBe(false);

    // no link: the photo's folder swapped for another holding an older file of that name
    const again = made();
    const older = join(again.dir, "older");
    mkdirSync(older);
    writeFileSync(join(older, "photo.jpg"), "older photo");
    writeFileSync(join(older, "other.jpg"), "other");
    for (const name of ["photo.jpg", "other.jpg"]) utimesSync(join(older, name), past, past);
    renameSync(join(again.dir, "sources"), join(again.dir, "sources-was"));
    renameSync(older, join(again.dir, "sources"));
    expect(outputCurrent(again.storyboard, again.file, again.dir)).toBe(false);
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
