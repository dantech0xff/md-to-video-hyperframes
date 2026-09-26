import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "./project.js";
import { readScriptPart, saveScriptPart, valueSpan } from "./script-edit.js";

const EXAMPLE = "examples/lessons/short-launch-vs-async/script.json";

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

  it("gives a chapter card without its scenes, and the outro without its switch", async () => {
    const { project: p } = await project();
    const chapter = readScriptPart(p, "script.json", "chapter-1");
    expect(chapter).toMatchObject({ kind: "chapter", type: "chapter", value: { title: "launch hay async?" }, advanced: [] });
    expect(Object.keys(chapter.schema.properties)).toEqual(["voice", "title"]);
    expect(chapter.schema.required).toEqual(["title"]);

    const outro = readScriptPart(p, "script.json", "outro");
    expect(outro).toMatchObject({ kind: "outro", value: { next: "Bài đầy đủ: Coroutines và Flow trên YouTube" } });
    expect(Object.keys(outro.schema.properties)).toEqual(["voice", "next", "title", "subtitle", "cta"]);
  });

  it("refuses the intro, a key the script does not have and a key two parts share", async () => {
    const { project: p } = await project((s) => (s.chapters[0].scenes[4].id = "outro"));
    expect(() => readScriptPart(p, "script.json", "intro")).toThrow(/nothing to edit/);
    expect(() => readScriptPart(p, "script.json", "nope")).toThrow(/no scene "nope"/);
    expect(() => readScriptPart(p, "script.json", "outro")).toThrow(/Several parts/);
  });

  it("reads scripts inside the project only", async () => {
    const { project: p } = await project();
    expect(() => readScriptPart(p, "../script.json", "hook")).toThrow(/outside the project folder/);
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
