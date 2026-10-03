import { describe, it, expect, vi } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "./project.js";
import { addScriptPart, duplicateScriptPart, moveScriptPart, readScriptPart, removeScriptPart, saveScriptPart, sceneTypes, valueSpan } from "./script-edit.js";

/** Runs `validate` while a save checks the edited script: another program writing meanwhile. */
const during = vi.hoisted(() => ({ validate: undefined as (() => void) | undefined }));
vi.mock("./tools.js", async (importOriginal) => {
  const tools = await importOriginal<typeof import("./tools.js")>();
  return {
    ...tools,
    validateScriptData: (raw: unknown) => {
      during.validate?.();
      return tools.validateScriptData(raw);
    },
  };
});

const EXAMPLE = "examples/lessons/short-launch-vs-async/script.json";

const canSymlink = (() => {
  try {
    const d = mkdtempSync(join(tmpdir(), "link-"));
    symlinkSync(d, join(d, "self"), "dir");
    return true;
  } catch {
    return false;
  }
})();

/** A project whose script paths another process switches once, right after the first is checked. */
class Switched extends Project {
  private switch?: () => void;
  constructor(dir: string, then: () => void) {
    super(dir);
    this.switch = then;
  }
  override path(p: string): string {
    const abs = super.path(p);
    const then = this.switch;
    this.switch = undefined;
    then?.();
    return abs;
  }
}

/** A project holding the example Short, changed by `edit` when given. */
async function project(edit?: (script: Record<string, any>) => void): Promise<{ project: Project; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "script-edit-"));
  const file = join(dir, "script.json");
  let text = await readFile(EXAMPLE, "utf8");
  if (edit) {
    const script = JSON.parse(text);
    edit(script);
    text = `${JSON.stringify(script, null, 2)}\n`;
  }
  await writeFile(file, text);
  return { project: new Project(dir), file };
}

describe("readScriptPart", () => {
  it("gives a scene's fields as the script has them, with the schema of what can be edited", async () => {
    const { project: p } = await project();
    const part = readScriptPart(p, "script.json", "diff");
    expect(part).toMatchObject({ key: "diff", kind: "scene", type: "compare" });
    expect(part.version).toMatch(/^[0-9a-f]{16}$/);
    // what the scene is and the id others refer to it by are not edited here
    expect(Object.keys(part.value)).toEqual(["voice", "title", "columns", "rows"]);
    expect(part.value.columns).toEqual(["launch", "async"]);
    const fields = Object.keys(part.schema.properties);
    expect(fields).not.toContain("type");
    expect(fields).not.toContain("id");
    // the narration first, what the scene shows next, the tuning last
    expect(fields[0]).toBe("voice");
    expect(fields.slice(-5)).toEqual(part.advanced);
    expect(part.advanced).toEqual(["mascot", "beats", "transition", "sfx", "hold"]);
    expect(part.schema.required).toEqual(["voice", "columns", "rows"]);
    expect(part.schema.properties.title).toMatchObject({ type: "string", maxLength: 70 });
    expect(part.schema.properties.winner).toMatchObject({ type: "integer", minimum: 0 });
  });

  it("finds a scene without an id by its place, as the storyboard keys it", async () => {
    const { project: p } = await project((s) => delete s.chapters[0].scenes[1].id);
    expect(readScriptPart(p, "script.json", "s2")).toMatchObject({ kind: "scene", type: "compare" });
  });

  it("reads a classic scene named by its catalog id with the classic scene's schema", async () => {
    const { project: p } = await project((s) => (s.chapters[0].scenes[0].type = "lesson.hook"));
    const part = readScriptPart(p, "script.json", "hook");
    expect(part.type).toBe("title");
    expect(Object.keys(part.schema.properties)).toContain("keyword");
  });

  it("gives a chapter card without its scenes, and the card and the outro with their switches", async () => {
    const { project: p } = await project();
    const chapter = readScriptPart(p, "script.json", "chapter-1");
    expect(chapter).toMatchObject({ kind: "chapter", type: "chapter", value: { title: "launch hay async?" }, advanced: [] });
    expect(Object.keys(chapter.schema.properties)).toEqual(["voice", "title", "card"]);
    expect(chapter.schema.required).toEqual(["title"]);

    const outro = readScriptPart(p, "script.json", "outro");
    expect(outro).toMatchObject({ kind: "outro", value: { next: "Bài đầy đủ: Coroutines và Flow trên YouTube" } });
    expect(Object.keys(outro.schema.properties)).toEqual(["voice", "next", "title", "subtitle", "cta", "enabled"]);
  });

  it("refuses a key the script does not have and a key two parts share", async () => {
    const { project: p } = await project((s) => (s.chapters[0].scenes[4].id = "outro"));
    expect(() => readScriptPart(p, "script.json", "nope")).toThrow(/no scene "nope"/);
    expect(() => readScriptPart(p, "script.json", "outro")).toThrow(/Several parts/);
  });

  it("reads scripts inside the project only", async () => {
    const { project: p } = await project();
    expect(() => readScriptPart(p, "../script.json", "hook")).toThrow(/outside the project folder/);
  });

  it.skipIf(!canSymlink)("reads nothing through a script switched for a link after its path was checked", async () => {
    const { project: p, file } = await project();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "script.json"), readFileSync(file, "utf8").replace("Launch", "Secret"));
    const switched = new Switched(p.dir, () => {
      unlinkSync(file);
      symlinkSync(join(outside, "script.json"), file);
    });
    expect(() => readScriptPart(switched, "script.json", "hook")).toThrow(/script\.json leads outside the project folder through a symbolic link/);
  });
});

describe("saveScriptPart", () => {
  it("writes the changed values in their place and leaves the rest of the file as it was", async () => {
    const { project: p, file } = await project();
    const before = await readFile(file, "utf8");
    const part = readScriptPart(p, "script.json", "diff");
    const value = { ...part.value, title: "Khác nhau chỗ nào?", columns: ["launch {}", 'async "x"'] };
    const res = saveScriptPart(p, "script.json", { key: "diff", version: part.version, value });
    expect(res).toMatchObject({ ok: true, changed: true });

    const after = await readFile(file, "utf8");
    const script = JSON.parse(after);
    expect(script.chapters[0].scenes[1]).toMatchObject({ id: "diff", type: "compare", title: "Khác nhau chỗ nào?", columns: ["launch {}", 'async "x"'] });
    // everything else byte for byte: the agent's one-line arrays too
    expect(after).toContain('"tags": ["kotlin", "coroutines", "android", "shorts"]');
    expect(after.replace('"Khác nhau chỗ nào?"', '"Khác nhau ở đâu?"').replace(/"columns": \[[^\]]*\]/, "")).toBe(before.replace(/"columns": \[[^\]]*\]/, ""));
    // the answer carries the file's new version
    expect(readScriptPart(p, "script.json", "diff").version).toBe(res.ok && res.version);
  });

  it("replaces the whole part when a field is added or removed, keeping the fields it does not know", async () => {
    const { project: p, file } = await project((s) => (s.chapters[0].scenes[0].note = "for the agent"));
    const part = readScriptPart(p, "script.json", "hook");
    const { subtitle, ...value } = part.value;
    expect(subtitle).toBeDefined();
    const res = saveScriptPart(p, "script.json", { key: "hook", version: part.version, value: { ...value, keyword: "async" } });
    expect(res).toMatchObject({ ok: true, changed: true });
    const hook = JSON.parse(await readFile(file, "utf8")).chapters[0].scenes[0];
    expect(hook.subtitle).toBeUndefined();
    expect(hook.keyword).toBe("async");
    expect(hook.note).toBe("for the agent");
    expect(Object.keys(hook)[0]).toBe("id");
  });

  it("never changes a scene's type or id", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "rule");
    const res = saveScriptPart(p, "script.json", { key: "rule", version: part.version, value: { ...part.value, type: "title", id: "other" } });
    expect(res).toMatchObject({ ok: true, changed: false });
    expect(JSON.parse(await readFile(file, "utf8")).chapters[0].scenes[4]).toMatchObject({ id: "rule", type: "statement" });
  });

  it("writes nothing when nothing changed", async () => {
    const { project: p, file } = await project();
    const before = await readFile(file, "utf8");
    const part = readScriptPart(p, "script.json", "parallel");
    expect(saveScriptPart(p, "script.json", { key: "parallel", version: part.version, value: part.value })).toEqual({ ok: true, version: part.version, changed: false });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("refuses a script that would not validate, with the problems relative to the part", async () => {
    const { project: p, file } = await project();
    const before = await readFile(file, "utf8");
    const quiz = readScriptPart(p, "script.json", "quiz");
    const res = saveScriptPart(p, "script.json", { key: "quiz", version: quiz.version, value: { ...quiz.value, question: "", answer: 7 } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => e.path).sort()).toEqual(["answer", "question"]);
    expect(res.others).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(before);

    // a phone scene needs a screenshot or a mock screen: a problem of the whole scene
    const { project: q } = await project((s) => (s.chapters[0].scenes[4] = { id: "rule", type: "phone", voice: "Xem.", ui: { appBar: "App" } }));
    const phone = readScriptPart(q, "script.json", "rule");
    const { ui, ...rest } = phone.value;
    expect(ui).toBeDefined();
    const bad = saveScriptPart(q, "script.json", { key: "rule", version: phone.version, value: rest });
    expect(bad).toMatchObject({ ok: false, errors: [{ path: "", message: expect.stringMatching(/image.*ui/) }] });
  });

  it("does not overwrite a script another program wrote while the save was checking it", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "hook");
    const theirs = `${await readFile(file, "utf8")}\n`;
    during.validate = () => writeFileSync(file, theirs);
    try {
      expect(saveScriptPart(p, "script.json", { key: "hook", version: part.version, value: { ...part.value, subtitle: "Mới" } })).toMatchObject({ ok: false, conflict: true });
    } finally {
      during.validate = undefined;
    }
    expect(await readFile(file, "utf8")).toBe(theirs);
  });

  it.skipIf(!canSymlink)("writes nothing through a folder switched for a link after the script's path was checked", async () => {
    // a Short's script, and the same script in a folder outside the project (another project, say)
    const { project: p, file } = await project();
    mkdirSync(join(p.dir, "short"));
    renameSync(file, join(p.dir, "short", "script.json"));
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    const text = readFileSync(join(p.dir, "short", "script.json"), "utf8");
    writeFileSync(join(outside, "script.json"), text);
    const part = readScriptPart(p, "short/script.json", "hook");
    const switched = new Switched(p.dir, () => {
      renameSync(join(p.dir, "short"), join(p.dir, "short-before"));
      symlinkSync(outside, join(p.dir, "short"), "dir");
    });
    expect(() => saveScriptPart(switched, "short/script.json", { key: "hook", version: part.version, value: { ...part.value, subtitle: "Mới" } })).toThrow(
      /short[\\/]script\.json leads outside the project folder through a symbolic link/,
    );
    expect(readFileSync(join(outside, "script.json"), "utf8")).toBe(text);
  });

  it("does not overwrite a script that changed after the part was read", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "hook");
    const changed = (await readFile(file, "utf8")).replace("launch hay async?", "launch or async?");
    await writeFile(file, changed);
    const res = saveScriptPart(p, "script.json", { key: "hook", version: part.version, value: { ...part.value, subtitle: "Mới" } });
    expect(res).toMatchObject({ ok: false, conflict: true });
    expect(await readFile(file, "utf8")).toBe(changed);
  });

  it("edits a chapter card's title without touching its scenes", async () => {
    const { project: p, file } = await project();
    const before = await readFile(file, "utf8");
    const part = readScriptPart(p, "script.json", "chapter-1");
    expect(saveScriptPart(p, "script.json", { key: "chapter-1", version: part.version, value: { title: "Chọn launch hay async" } })).toMatchObject({ ok: true, changed: true });
    const after = await readFile(file, "utf8");
    expect(after).toBe(before.replace('"title": "launch hay async?"', '"title": "Chọn launch hay async"'));
  });

  it("adds an outro the script left to its default, and leaves it out when nothing was entered", async () => {
    const { project: p, file } = await project((s) => delete s.outro);
    const part = readScriptPart(p, "script.json", "outro");
    expect(part.value).toEqual({});
    expect(saveScriptPart(p, "script.json", { key: "outro", version: part.version, value: {} })).toMatchObject({ ok: true, changed: false });
    expect(JSON.parse(await readFile(file, "utf8")).outro).toBeUndefined();
    expect(saveScriptPart(p, "script.json", { key: "outro", version: part.version, value: { next: "Tập sau: Flow" } })).toMatchObject({ ok: true, changed: true });
    expect(JSON.parse(await readFile(file, "utf8")).outro).toEqual({ next: "Tập sau: Flow" });
  });

  it("keeps the file's line endings and indentation", async () => {
    const { project: p, file } = await project();
    const tabbed = `${JSON.stringify(JSON.parse(await readFile(file, "utf8")), null, "\t").replace(/\n/g, "\r\n")}\r\n`;
    await writeFile(file, tabbed);
    const part = readScriptPart(p, "script.json", "diff");
    const rows = [...(part.value.rows as unknown[]), { label: "Huỷ", values: ["job.cancel()", "deferred.cancel()"] }];
    expect(saveScriptPart(p, "script.json", { key: "diff", version: part.version, value: { ...part.value, rows } })).toMatchObject({ ok: true });
    const after = await readFile(file, "utf8");
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
    expect(after.endsWith("}\r\n")).toBe(true);
    expect(after).toContain('\r\n\t\t\t\t\t\t{\r\n\t\t\t\t\t\t\t"label": "Huỷ",');
    expect(JSON.parse(after).chapters[0].scenes[1].rows).toHaveLength(4);
  });
});

describe("removeScriptPart", () => {
  it("cuts a scene out of its chapter and leaves the rest of the file byte for byte", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "diff");
    const res = removeScriptPart(p, "script.json", { key: "diff", version: part.version });
    expect(res).toMatchObject({ ok: true, changed: true });

    const after = await readFile(file, "utf8");
    expect(JSON.parse(after).chapters[0].scenes.map((s: { id?: string }) => s.id)).toEqual(["hook", "parallel", "quiz", "rule"]);
    // the scene's whole object is gone, and the agent's one-line arrays are still one-line
    expect(after).not.toContain('"id": "diff"');
    expect(after).not.toContain("Khác nhau ở đâu?");
    expect(after).toContain('"tags": ["kotlin", "coroutines", "android", "shorts"]');
    expect(() => readScriptPart(p, "script.json", "diff")).toThrow(/no scene "diff"/);
    // the next scene's key is what it was: ids, not positions, when scenes have them
    expect(readScriptPart(p, "script.json", "parallel").kind).toBe("scene");
  });

  it("removes the chapter too when the scene was its last", async () => {
    const { project: p, file } = await project((s) => {
      s.chapters = [
        { title: "Mở", scenes: [s.chapters[0].scenes[0]] },
        { title: "Phần chính", scenes: s.chapters[0].scenes.slice(1) },
      ];
    });
    const part = readScriptPart(p, "script.json", "hook");
    expect(removeScriptPart(p, "script.json", { key: "hook", version: part.version })).toMatchObject({ ok: true, changed: true });
    const script = JSON.parse(await readFile(file, "utf8"));
    expect(script.chapters).toHaveLength(1);
    expect(script.chapters[0]).toMatchObject({ title: "Phần chính" });
    expect(script.chapters[0].scenes.map((s: { id?: string }) => s.id)).toEqual(["diff", "parallel", "quiz", "rule"]);
    expect(() => readScriptPart(p, "script.json", "chapter-2")).toThrow(/no scene/);
  });

  it("refuses to remove the script's last scene", async () => {
    const { project: p, file } = await project((s) => (s.chapters[0].scenes = [s.chapters[0].scenes[0]]));
    const before = await readFile(file, "utf8");
    const part = readScriptPart(p, "script.json", "hook");
    const res = removeScriptPart(p, "script.json", { key: "hook", version: part.version });
    expect(res).toMatchObject({ ok: false, errors: [{ path: "", message: expect.stringMatching(/ít nhất một cảnh/) }] });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("switches a chapter's card off instead of dropping its scenes", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "chapter-1");
    expect(removeScriptPart(p, "script.json", { key: "chapter-1", version: part.version })).toMatchObject({ ok: true, changed: true });
    const after = await readFile(file, "utf8");
    const script = JSON.parse(after);
    expect(script.chapters[0].card).toBe(false);
    expect(script.chapters[0].scenes).toHaveLength(5);
    // a member of its own at the top of the chapter, the rest untouched
    expect(after.replace(/\r\n/g, "\n")).toContain('{\n      "card": false,\n      "title": "launch hay async?"');
    expect(after).toContain('"tags": ["kotlin", "coroutines", "android", "shorts"]');
    // the review lists the card while it is off: its form switches it back on, the scenes left as they are
    const off = readScriptPart(p, "script.json", "chapter-1");
    expect(off.value).toMatchObject({ card: false, title: "launch hay async?" });
    expect(saveScriptPart(p, "script.json", { key: "chapter-1", version: off.version, value: { ...off.value, card: true } })).toMatchObject({ ok: true, changed: true });
    const on = JSON.parse(await readFile(file, "utf8")).chapters[0];
    expect(on.card).toBe(true);
    expect(on.scenes).toHaveLength(5);
  });

  it("switches the outro off, keeping its fields, and its form switches it back on", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "outro");
    expect(removeScriptPart(p, "script.json", { key: "outro", version: part.version })).toMatchObject({ ok: true });
    const script = JSON.parse(await readFile(file, "utf8"));
    expect(script.outro).toEqual({ enabled: false, next: "Bài đầy đủ: Coroutines và Flow trên YouTube", voice: "Theo dõi Dan Tech để học trọn Coroutines và Flow nhé." });
    // the review still lists the outro while it is off: its form is the way back
    const again = readScriptPart(p, "script.json", "outro");
    expect(again.value).toMatchObject({ enabled: false, next: "Bài đầy đủ: Coroutines và Flow trên YouTube" });
    expect(saveScriptPart(p, "script.json", { key: "outro", version: again.version, value: { ...again.value, enabled: true } })).toMatchObject({ ok: true, changed: true });
    expect(JSON.parse(await readFile(file, "utf8")).outro).toMatchObject({ enabled: true, next: "Bài đầy đủ: Coroutines và Flow trên YouTube" });
  });

  it("writes nothing, and tells nothing changed, for a part that is off already", async () => {
    // the example's sting is "none": with the outro off too, both are listed only to be switched back
    const { project: p, file } = await project((s) => (s.outro.enabled = false));
    const before = await readFile(file, "utf8");
    for (const key of ["intro", "outro"]) {
      const part = readScriptPart(p, "script.json", key);
      expect(removeScriptPart(p, "script.json", { key, version: part.version })).toEqual({ ok: true, version: part.version, changed: false });
    }
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("writes an outro the script did not have when the storyboard showed the default one", async () => {
    const { project: p, file } = await project((s) => delete s.outro);
    const part = readScriptPart(p, "script.json", "outro");
    expect(removeScriptPart(p, "script.json", { key: "outro", version: part.version })).toMatchObject({ ok: true, changed: true });
    expect(JSON.parse(await readFile(file, "utf8")).outro).toEqual({ enabled: false });
  });

  it("does not overwrite a script that changed after the part was read", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "hook");
    const changed = (await readFile(file, "utf8")).replace("launch hay async?", "launch or async?");
    await writeFile(file, changed);
    expect(removeScriptPart(p, "script.json", { key: "hook", version: part.version })).toMatchObject({ ok: false, conflict: true });
    expect(await readFile(file, "utf8")).toBe(changed);
  });
});

describe("addScriptPart", () => {
  it("adds a scene of the type asked at the end of its chapter, under an id of its own", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "rule");
    const res = addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type: "quiz", version: part.version });
    expect(res).toMatchObject({ ok: true, changed: true, key: "quiz-2" });

    const after = await readFile(file, "utf8");
    const scenes = JSON.parse(after).chapters[0].scenes;
    expect(scenes.map((s: { id?: string }) => s.id)).toEqual(["hook", "diff", "parallel", "quiz", "rule", "quiz-2"]);
    expect(scenes[5]).toMatchObject({ type: "quiz", voice: expect.any(String) });
    // the new scene is written in the file's own layout, the rest byte for byte
    expect(after.replace(/\r\n/g, "\n")).toContain('"id": "quiz-2"');
    expect(readScriptPart(p, "script.json", "quiz-2").kind).toBe("scene");
  });

  it("adds a chapter holding one starter scene at the end of the script", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "hook");
    const res = addScriptPart(p, "script.json", { kind: "chapter", type: "statement", version: part.version });
    expect(res).toMatchObject({ ok: true, changed: true, key: "chapter-2" });

    const script = JSON.parse(await readFile(file, "utf8"));
    expect(script.chapters).toHaveLength(2);
    expect(script.chapters[1]).toMatchObject({ title: "Chương mới" });
    expect(script.chapters[1].scenes).toHaveLength(1);
    expect(script.chapters[1].scenes[0].type).toBe("statement");
    // the new chapter is part of the storyboard's keys
    expect(readScriptPart(p, "script.json", "chapter-2").kind).toBe("chapter");
  });

  it("every type a new scene may have writes a scene the script accepts", async () => {
    const { project: p } = await project();
    for (const type of sceneTypes()) {
      const part = readScriptPart(p, "script.json", "hook");
      const res = addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type, version: part.version });
      expect(res, type).toMatchObject({ ok: true, changed: true });
    }
    const script = JSON.parse(readFileSync(join(p.dir, "script.json"), "utf8"));
    expect(script.chapters[0].scenes).toHaveLength(5 + sceneTypes().length);
  });

  it("writes the placeholder file a new image scene points at, next to the script", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "hook");
    const res = addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type: "image", version: part.version });
    expect(res).toMatchObject({ ok: true, changed: true, key: "image" });
    const scenes = JSON.parse(await readFile(file, "utf8")).chapters[0].scenes;
    expect(scenes[5]).toMatchObject({ type: "image", src: "image.svg" });
    // the storyboard finds the file: no "image not found" build failure
    expect(await readFile(join(p.dir, "image.svg"), "utf8")).toContain("<svg");
  });

  it("keeps a file of the user's the placeholder name happens to land on", async () => {
    const { project: p } = await project();
    await writeFile(join(p.dir, "image.svg"), "user's own svg");
    const part = readScriptPart(p, "script.json", "hook");
    expect(addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type: "image", version: part.version })).toMatchObject({ ok: true });
    expect(await readFile(join(p.dir, "image.svg"), "utf8")).toBe("user's own svg");
  });

  it.skipIf(!canSymlink)("leaves a link the placeholder name lands on, and looks nothing up where it leads", async () => {
    const { project: p } = await project();
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    symlinkSync(join(outside, "image.svg"), join(p.dir, "image.svg"));
    const part = readScriptPart(p, "script.json", "hook");
    expect(addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type: "image", version: part.version })).toMatchObject({ ok: true });
    expect(lstatSync(join(p.dir, "image.svg")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(outside, "image.svg"))).toBe(false);
  });

  it.skipIf(!canSymlink)("keeps a link inside the project the placeholder name lands on, even to a file not there yet", async () => {
    const { project: p } = await project();
    mkdirSync(join(p.dir, "sources"));
    symlinkSync(join("sources", "future.svg"), join(p.dir, "image.svg"));
    const part = readScriptPart(p, "script.json", "hook");
    expect(addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type: "image", version: part.version })).toMatchObject({ ok: true });
    expect(lstatSync(join(p.dir, "image.svg")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(p.dir, "image.svg"))).toBe(join("sources", "future.svg"));
  });

  it("leaves no placeholder behind when another program wrote the script while the add was checking it", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "hook");
    const theirs = `${await readFile(file, "utf8")}\n`;
    during.validate = () => writeFileSync(file, theirs);
    try {
      expect(addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type: "image", version: part.version })).toMatchObject({ ok: false, conflict: true });
    } finally {
      during.validate = undefined;
    }
    expect(existsSync(join(p.dir, "image.svg"))).toBe(false);
    expect(await readFile(file, "utf8")).toBe(theirs);
  });

  it("refuses an unknown type and a key that is not a chapter", async () => {
    const { project: p, file } = await project();
    const before = await readFile(file, "utf8");
    const part = readScriptPart(p, "script.json", "hook");
    expect(() => addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type: "wat", version: part.version })).toThrow(/Unknown scene type/);
    expect(() => addScriptPart(p, "script.json", { kind: "scene", chapter: "hook", type: "quiz", version: part.version })).toThrow(/not a chapter/);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("does not overwrite a script that changed after the part was read", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "hook");
    const changed = (await readFile(file, "utf8")).replace("launch hay async?", "launch or async?");
    await writeFile(file, changed);
    expect(addScriptPart(p, "script.json", { kind: "chapter", type: "quiz", version: part.version })).toMatchObject({ ok: false, conflict: true });
    expect(await readFile(file, "utf8")).toBe(changed);
  });
});

describe("duplicateScriptPart", () => {
  it("adds a copy of the scene right after it, under an id of its own", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "parallel");
    const res = duplicateScriptPart(p, "script.json", { key: "parallel", version: part.version });
    expect(res).toMatchObject({ ok: true, changed: true, key: "parallel-copy" });

    const after = await readFile(file, "utf8");
    const scenes = JSON.parse(after).chapters[0].scenes;
    expect(scenes.map((s: { id?: string }) => s.id)).toEqual(["hook", "diff", "parallel", "parallel-copy", "quiz", "rule"]);
    expect(scenes[3]).toEqual({ ...scenes[2], id: "parallel-copy" });
  });

  it("numbers the copy when the first id is taken", async () => {
    const { project: p } = await project();
    let part = readScriptPart(p, "script.json", "parallel");
    expect(duplicateScriptPart(p, "script.json", { key: "parallel", version: part.version })).toMatchObject({ ok: true, key: "parallel-copy" });
    part = readScriptPart(p, "script.json", "parallel");
    expect(duplicateScriptPart(p, "script.json", { key: "parallel", version: part.version })).toMatchObject({ ok: true, key: "parallel-copy-2" });
  });

  it("names a scene without an id after its storyboard key", async () => {
    const { project: p } = await project((s) => delete s.chapters[0].scenes[2].id);
    const part = readScriptPart(p, "script.json", "s3");
    expect(duplicateScriptPart(p, "script.json", { key: "s3", version: part.version })).toMatchObject({ ok: true, key: "s3-copy" });
  });

  it("has no copy of a chapter card, the intro or the outro", async () => {
    const { project: p } = await project();
    const part = readScriptPart(p, "script.json", "chapter-1");
    expect(() => duplicateScriptPart(p, "script.json", { key: "chapter-1", version: part.version })).toThrow(/Chỉ nhân bản được cảnh/);
    expect(() => duplicateScriptPart(p, "script.json", { key: "outro", version: part.version })).toThrow(/Chỉ nhân bản được cảnh/);
  });
});

describe("moveScriptPart", () => {
  it("trades a scene with the one before or after it, the rest byte for byte", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "diff");
    expect(moveScriptPart(p, "script.json", { key: "diff", direction: "down", version: part.version })).toMatchObject({ ok: true, changed: true });

    const after = await readFile(file, "utf8");
    expect(JSON.parse(after).chapters[0].scenes.map((s: { id?: string }) => s.id)).toEqual(["hook", "parallel", "diff", "quiz", "rule"]);
    // the two scenes traded places in the file itself: their texts are whole
    expect(after.indexOf('"id": "parallel"')).toBeLessThan(after.indexOf('"id": "diff"'));
    expect(after.indexOf('"id": "diff"')).toBeLessThan(after.indexOf('"id": "quiz"'));
  });

  it("moves a scene over its chapter's edge into the next one", async () => {
    const { project: p, file } = await project((s) => {
      s.chapters = [
        { title: "Mở", scenes: s.chapters[0].scenes.slice(0, 2) },
        { title: "Phần chính", scenes: s.chapters[0].scenes.slice(2) },
      ];
    });
    const part = readScriptPart(p, "script.json", "parallel");
    expect(moveScriptPart(p, "script.json", { key: "parallel", direction: "up", version: part.version })).toMatchObject({ ok: true, changed: true });
    const script = JSON.parse(await readFile(file, "utf8"));
    expect(script.chapters[0].scenes.map((s: { id?: string }) => s.id)).toEqual(["hook", "diff", "parallel"]);
    expect(script.chapters[1].scenes.map((s: { id?: string }) => s.id)).toEqual(["quiz", "rule"]);
  });

  it("drops the chapter the last scene left", async () => {
    const { project: p, file } = await project((s) => {
      s.chapters = [
        { title: "Mở", scenes: s.chapters[0].scenes.slice(0, 4) },
        { title: "Cuối", scenes: s.chapters[0].scenes.slice(4) },
      ];
    });
    const part = readScriptPart(p, "script.json", "rule");
    expect(moveScriptPart(p, "script.json", { key: "rule", direction: "up", version: part.version })).toMatchObject({ ok: true, changed: true });
    const script = JSON.parse(await readFile(file, "utf8"));
    expect(script.chapters).toHaveLength(1);
    expect(script.chapters[0].scenes.map((s: { id?: string }) => s.id)).toEqual(["hook", "diff", "parallel", "quiz", "rule"]);
  });

  it("moves a chapter over the one before or after it", async () => {
    const { project: p, file } = await project((s) => {
      s.chapters = [
        { title: "Mở", scenes: s.chapters[0].scenes.slice(0, 2) },
        { title: "Phần chính", scenes: s.chapters[0].scenes.slice(2) },
      ];
    });
    const part = readScriptPart(p, "script.json", "chapter-2");
    expect(moveScriptPart(p, "script.json", { key: "chapter-2", direction: "up", version: part.version })).toMatchObject({ ok: true, changed: true });
    const script = JSON.parse(await readFile(file, "utf8"));
    expect(script.chapters.map((c: { title: string }) => c.title)).toEqual(["Phần chính", "Mở"]);
    expect(script.chapters[0].scenes.map((s: { id?: string }) => s.id)).toEqual(["parallel", "quiz", "rule"]);
  });

  it("refuses the edges, the intro and the outro", async () => {
    const { project: p } = await project();
    let part = readScriptPart(p, "script.json", "hook");
    expect(moveScriptPart(p, "script.json", { key: "hook", direction: "up", version: part.version })).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/đầu/) }] });
    part = readScriptPart(p, "script.json", "rule");
    expect(moveScriptPart(p, "script.json", { key: "rule", direction: "down", version: part.version })).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/cuối/) }] });
    part = readScriptPart(p, "script.json", "chapter-1");
    expect(moveScriptPart(p, "script.json", { key: "chapter-1", direction: "up", version: part.version })).toMatchObject({ ok: false });
    part = readScriptPart(p, "script.json", "outro");
    expect(moveScriptPart(p, "script.json", { key: "outro", direction: "up", version: part.version })).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/không đổi thứ tự/) }] });
  });

  it("reports the key a moved part is shown under now", async () => {
    const { project: p } = await project((s) => {
      s.chapters = [
        { title: "Mở", scenes: s.chapters[0].scenes.slice(0, 2) },
        { title: "Phần chính", scenes: s.chapters[0].scenes.slice(2) },
      ];
      delete s.chapters[1].scenes[0].id; // the storyboard keys it "s3"
    });
    // a positional key follows the scene to its new place; a chapter key follows its new position
    let part = readScriptPart(p, "script.json", "s3");
    expect(moveScriptPart(p, "script.json", { key: "s3", direction: "down", version: part.version })).toMatchObject({ ok: true, key: "s4" });
    part = readScriptPart(p, "script.json", "chapter-2");
    expect(moveScriptPart(p, "script.json", { key: "chapter-2", direction: "up", version: part.version })).toMatchObject({ ok: true, key: "chapter-1" });
    part = readScriptPart(p, "script.json", "quiz");
    expect(moveScriptPart(p, "script.json", { key: "quiz", direction: "down", version: part.version })).toMatchObject({ ok: true, key: "quiz" });
  });

  it("does not overwrite a script that changed after the part was read", async () => {
    const { project: p, file } = await project();
    const part = readScriptPart(p, "script.json", "hook");
    const changed = (await readFile(file, "utf8")).replace("launch hay async?", "launch or async?");
    await writeFile(file, changed);
    expect(moveScriptPart(p, "script.json", { key: "hook", direction: "down", version: part.version })).toMatchObject({ ok: false, conflict: true });
    expect(await readFile(file, "utf8")).toBe(changed);
  });
});

describe("the keys a change gave other parts", () => {
  /** The example's scenes in two chapters, the first scene of the second without an id: the storyboard keys it "s3". */
  const twoChapters = (s: Record<string, any>) => {
    s.chapters = [
      { title: "Mở", scenes: s.chapters[0].scenes.slice(0, 2) },
      { title: "Phần chính", scenes: s.chapters[0].scenes.slice(2) },
    ];
    delete s.chapters[1].scenes[0].id;
  };

  it("a move: a key made from a place follows its part, chapter keys trade places", async () => {
    const { project: p } = await project(twoChapters);
    let part = readScriptPart(p, "script.json", "s3");
    let res = moveScriptPart(p, "script.json", { key: "s3", direction: "down", version: part.version });
    // the quiz it traded places with keeps its id
    expect(res.ok && res.renamed).toEqual({ s3: "s4" });
    part = readScriptPart(p, "script.json", "chapter-2");
    res = moveScriptPart(p, "script.json", { key: "chapter-2", direction: "up", version: part.version });
    expect(res.ok && res.renamed).toEqual({ "chapter-1": "chapter-2", "chapter-2": "chapter-1", s4: "s2" });
  });

  it("a removal: the key of the part gone, and those the parts after it moved to", async () => {
    const { project: p } = await project((s) => {
      delete s.chapters[0].scenes[1].id;
      delete s.chapters[0].scenes[3].id;
    });
    const part = readScriptPart(p, "script.json", "s2");
    const res = removeScriptPart(p, "script.json", { key: "s2", version: part.version });
    expect(res.ok && res.renamed).toEqual({ s2: null, s4: "s3" });
  });

  it("an add or a copy: the keys of the parts it pushed along; none at the very end", async () => {
    const { project: p } = await project(twoChapters);
    let part = readScriptPart(p, "script.json", "hook");
    let res = addScriptPart(p, "script.json", { kind: "scene", chapter: "chapter-1", type: "statement", version: part.version });
    expect(res.ok && res.renamed).toEqual({ s3: "s4" });
    part = readScriptPart(p, "script.json", "hook");
    res = duplicateScriptPart(p, "script.json", { key: "hook", version: part.version });
    expect(res.ok && res.renamed).toEqual({ s4: "s5" });
    part = readScriptPart(p, "script.json", "hook");
    res = addScriptPart(p, "script.json", { kind: "chapter", type: "statement", version: part.version });
    expect(res).toMatchObject({ ok: true, changed: true });
    expect(res.ok && res.renamed).toBeUndefined();
  });
});

describe("valueSpan", () => {
  const span = (text: string, path: (string | number)[]) => {
    const at = valueSpan(text, path);
    return at && text.slice(at[0], at[1]);
  };

  it("finds values by key and index, whatever their strings hold", () => {
    const text = '{ "a": "x\\"}]", "b": [1, {"c": [true, null]}, "d"], "e": {}, "f": [] }';
    expect(span(text, ["a"])).toBe('"x\\"}]"');
    expect(span(text, ["b", 1, "c"])).toBe("[true, null]");
    expect(span(text, ["b", 1, "c", 1])).toBe("null");
    expect(span(text, ["b", 2])).toBe('"d"');
    expect(span(text, ["e"])).toBe("{}");
    expect(span(text, [])).toBe(text);
    expect(span(text, ["e", "x"])).toBeUndefined();
    expect(span(text, ["f", 0])).toBeUndefined();
    expect(span(text, ["b", 3])).toBeUndefined();
    expect(span(text, ["a", 0])).toBeUndefined();
  });

  it("takes the last of duplicate keys, as JSON.parse does", () => {
    expect(span('{"a": 1, "b": {"a": 3}, "a": 2}', ["a"])).toBe("2");
  });
});

describe("the intro", () => {
  it("reads where the sting plays as a part of its own", async () => {
    const { project: p } = await project();
    const part = readScriptPart(p, "script.json", "intro");
    expect(part).toMatchObject({ kind: "intro", type: "intro", value: { intro: "none" } });
    expect(Object.keys(part.schema.properties)).toEqual(["intro"]);
  });

  it("reads \"auto\" when the script does not name the sting, and writes the member it did not have", async () => {
    const { project: p, file } = await project((s) => delete s.intro);
    const part = readScriptPart(p, "script.json", "intro");
    expect(part.value).toEqual({ intro: "auto" });
    const res = saveScriptPart(p, "script.json", { key: "intro", version: part.version, value: { intro: "after-first" } });
    expect(res).toMatchObject({ ok: true, changed: true });
    expect(JSON.parse(await readFile(file, "utf8")).intro).toBe("after-first");
  });

  it("writes the spot it plays in place, the rest of the file byte for byte", async () => {
    const { project: p, file } = await project();
    const before = await readFile(file, "utf8");
    const part = readScriptPart(p, "script.json", "intro");
    const res = saveScriptPart(p, "script.json", { key: "intro", version: part.version, value: { intro: "start" } });
    expect(res).toMatchObject({ ok: true, changed: true });
    const after = await readFile(file, "utf8");
    expect(after).toBe(before.replace('"intro": "none"', '"intro": "start"'));
    expect(readScriptPart(p, "script.json", "intro").value).toEqual({ intro: "start" });
  });

  it("changes nothing when the spot saved is the spot it was", async () => {
    const { project: p, file } = await project();
    const before = await readFile(file, "utf8");
    const part = readScriptPart(p, "script.json", "intro");
    const res = saveScriptPart(p, "script.json", { key: "intro", version: part.version, value: { intro: "none" } });
    expect(res).toMatchObject({ ok: true, changed: false });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("switches the sting off when removed, it does not leave the script", async () => {
    const { project: p, file } = await project((s) => (s.intro = "start"));
    const part = readScriptPart(p, "script.json", "intro");
    const res = removeScriptPart(p, "script.json", { key: "intro", version: part.version });
    expect(res).toMatchObject({ ok: true, changed: true });
    const after = await readFile(file, "utf8");
    expect(after).toContain('"intro": "none"');
    expect(JSON.parse(after).intro).toBe("none");
  });

  it("is not moved nor duplicated like a scene", async () => {
    const { project: p } = await project();
    const part = readScriptPart(p, "script.json", "intro");
    expect(moveScriptPart(p, "script.json", { key: "intro", direction: "down", version: part.version })).toMatchObject({ ok: false });
    expect(() => duplicateScriptPart(p, "script.json", { key: "intro", version: part.version })).toThrow(/nhân bản/);
  });
});
