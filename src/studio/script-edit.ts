/**
 * Editing, removing, adding or moving parts of a script by hand, as the
 * desktop app's storyboard review does without the agent: a scene, a chapter
 * card or the outro, found by the key the storyboard shows it under ("hook",
 * "s3", "chapter-2", "outro").
 *
 * The app gets the part's fields as script.json has them (no defaults filled
 * in, so a save changes only what the user changed) with the JSON Schema of
 * those fields, and saves them back: the whole script must validate before it
 * is written, the file is replaced in one step, and a script that changed in
 * the meantime is not overwritten. The script is read from the file opened
 * and written through a new one, each checked inside the project: the agent
 * could switch it, or its folder, for a symbolic link at any time.
 */
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { SCENE_IMAGE_FIELDS } from "../lesson/inputs.js";
import { common } from "../lesson/schema-common.js";
import { TYPE_ALIASES } from "../lesson/schema-templates.js";
import { LessonScriptSchema, SceneSchema } from "../lesson/schema.js";
import { readInside, resolveInside, writeInside } from "../utils/inside.js";
import type { Project } from "./project.js";
import { validateScriptData, type Problem } from "./tools.js";

/** A JSON Schema (draft 2020-12), as plain JSON. */
export type JsonSchema = { [keyword: string]: unknown };

export type ScriptPartKind = "scene" | "intro" | "chapter" | "outro";

export interface ScriptPart {
  key: string;
  kind: ScriptPartKind;
  /** the scene's type as the engine reads it ("lesson.hook" is "title"), else "chapter" or "outro" */
  type: string;
  /** the editable fields as script.json has them */
  value: Record<string, unknown>;
  /** JSON Schema of an object holding the editable fields: the narration first, the advanced ones last */
  schema: JsonSchema & { properties: Record<string, JsonSchema>; required: string[] };
  /** fields that tune timing, transitions, sounds and the mascot rather than what the part shows or says */
  advanced: string[];
  /** fingerprint of the script as read; a save checks it */
  version: string;
}

export interface PartEdit {
  key: string;
  /** the version the edit started from */
  version: string;
  /** every editable field: one left out is removed from the script */
  value: Record<string, unknown>;
}

/** What identifies the part the user removes or duplicates: its storyboard key and the script's version as the review read it. */
export interface PartRemoval {
  key: string;
  version: string;
}

/** The part the user adds: a scene of `type` into the chapter keyed `chapter`, or a chapter holding one starter scene of `type`. */
export interface PartAdd {
  kind: "scene" | "chapter";
  /** the new scene's chapter, as the storyboard keys it ("chapter-2") */
  chapter?: string;
  /** the scene's type as script.json writes it ("code", "news.breaking"); a chapter's starter scene defaults to "bullets" */
  type?: string;
  version: string;
}

/** The part the user moves one place: a scene inside its chapter — over the chapter's edge, into the next one — or a chapter inside the script. */
export interface PartMove {
  key: string;
  direction: "up" | "down";
  version: string;
}

export type SavePartResult =
  | {
      ok: true;
      version: string;
      changed: boolean;
      /** the storyboard key of the part an add or duplicate made */
      key?: string;
      /**
       * Keys a remove, add, duplicate or move gave to other parts: old key → new
       * one, null for a part that is gone. A key made from a place ("s3",
       * "chapter-2") moves with the parts before it; the app keeps its notes on
       * the part, not the place.
       */
      renamed?: Record<string, string | null>;
    }
  | {
      ok: false;
      /** the script changed since the part was read: nothing was written */
      conflict?: boolean;
      /** problems in the part, with paths relative to it ("" for the part as a whole) */
      errors: Problem[];
      /** problems elsewhere in the script, with their full paths */
      others: Problem[];
    };

/** Fields of a scene that are not edited here: what kind of scene it is and the id others refer to it by. */
const SCENE_FIXED = ["type", "id"];
/** The storyboard shows a chapter's card, not its scenes. Whether the card shows is the user's: deleting it sets `card: false`, its form sets it back. */
const CHAPTER_FIXED = ["scenes"];
/** Nothing: deleting the outro switches it off (`enabled: false`), and its form switches it back on. */
const OUTRO_FIXED: string[] = [];
/** The fields every scene has besides its id and narration. */
const ADVANCED = Object.keys(common).filter((k) => k !== "id" && k !== "voice");

export function readScriptPart(project: Project, script: string, key: string): ScriptPart {
  const text = readScript(project, script);
  const at = locate(parse(text, script), key, script);
  const { type, schema, advanced } = describe(at);
  const value = Object.fromEntries(Object.entries(at.part).filter(([k]) => k in schema.properties));
  return { key, kind: at.kind, type, value, schema, advanced, version: fingerprint(text) };
}

export function saveScriptPart(project: Project, script: string, edit: PartEdit): SavePartResult {
  const text = readScript(project, script);
  if (fingerprint(text) !== edit.version) return changedMeanwhile(script);
  if (!isObject(edit.value)) throw new Error("The edited fields must be an object");
  const raw = parse(text, script);
  const at = locate(raw, edit.key, script);
  const names = Object.keys(describe(at).schema.properties);
  // the fields the form does not show stay as they are, in their place: the fixed ones and any the schema does not know
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(at.part)) {
    if (!names.includes(k)) next[k] = v;
    else if (edit.value[k] !== undefined) next[k] = edit.value[k];
  }
  for (const k of names) if (!(k in next) && edit.value[k] !== undefined) next[k] = edit.value[k];
  if (JSON.stringify(next) === JSON.stringify(at.part)) return { ok: true, version: edit.version, changed: false };

  at.put(next);
  const check = validateScriptData(raw);
  if (!check.ok) return { ok: false, ...byPart(check.errors, at.path) };
  // the intro is one member of the script, not an object of its own
  const out = at.kind === "intro" ? (memberSet(text, [], "intro", next.intro, raw) ?? relaid(text, raw)) : edited(text, at.path, at.part, next, raw);
  // another program (an editor, something the agent left running) may have written the script meanwhile:
  // checked again right before the new file takes its place
  if (fingerprint(readScript(project, script)) !== edit.version) return changedMeanwhile(script);
  writeInside(project.dir, project.path(script), out);
  return { ok: true, version: fingerprint(out), changed: true };
}

/**
 * Removes the part the storyboard shows under `removal.key`: a scene goes out
 * of its chapter (the chapter too when it held only that scene), while a
 * chapter's card and the outro are switched off (`card`/`enabled`: their
 * content stays in the script, the storyboard just no longer shows them).
 * The same rules as saveScriptPart: the script must still validate, and one
 * changed since it was read is not overwritten.
 */
export function removeScriptPart(project: Project, script: string, removal: PartRemoval): SavePartResult {
  const text = readScript(project, script);
  if (fingerprint(text) !== removal.version) return changedMeanwhile(script);
  const raw = parse(text, script);
  const at = locate(raw, removal.key, script);
  const before = partKeys(raw);

  let out: string;
  if (at.kind === "scene") {
    const chapters = (raw as Record<string, unknown>).chapters as { scenes: unknown[] }[];
    const ci = at.path[1] as number;
    const scenes = chapters[ci].scenes;
    scenes.splice(at.path[3] as number, 1);
    let gone = at.path;
    if (!scenes.length) {
      if (chapters.length < 2) return { ok: false, errors: [{ path: "", message: "Kịch bản cần giữ ít nhất một cảnh" }], others: [] };
      chapters.splice(ci, 1);
      gone = ["chapters", ci];
    }
    out = removed(text, gone, raw);
  } else if (at.kind === "intro") {
    // the sting is not removed: it is switched off
    at.put({ intro: "none" });
    out = memberSet(text, [], "intro", "none", raw) ?? relaid(text, raw);
  } else {
    // a chapter card or the outro is not removed from the script: it is switched off
    const flag = at.kind === "chapter" ? "card" : "enabled";
    const next = { ...at.part, [flag]: false };
    at.put(next);
    out = memberSet(text, at.path, flag, false, raw) ?? edited(text, at.path, at.part, next, raw);
  }
  // a part already off (the review still lists it, to switch it back): nothing to write, rebuild or tell the agent
  if (JSON.stringify(raw) === JSON.stringify(parse(text, script))) return { ok: true, version: removal.version, changed: false };

  const check = validateScriptData(raw);
  if (!check.ok) return { ok: false, ...byPart(check.errors, at.path) };
  if (fingerprint(readScript(project, script)) !== removal.version) return changedMeanwhile(script);
  writeInside(project.dir, project.path(script), out);
  return { ok: true, version: fingerprint(out), changed: true, renamed: renamedKeys(before, raw) };
}

/**
 * Adds a part: a scene of `add.type` at the end of `add.chapter`, or a chapter
 * at the end of the script holding one starter scene of that type. The scene
 * gets an id no scene has and its type's required fields filled with starter
 * text to edit right away; the same rules as saveScriptPart.
 */
export function addScriptPart(project: Project, script: string, add: PartAdd): SavePartResult {
  const text = readScript(project, script);
  if (fingerprint(text) !== add.version) return changedMeanwhile(script);
  const raw = parse(text, script);
  const chapters = chaptersOf(raw, script);
  const before = partKeys(raw);

  let path: (string | number)[];
  let value: Record<string, unknown>;
  let added: Record<string, unknown>;
  let key: string;
  if (add.kind === "chapter") {
    const scene = newScene(raw, add.type ?? "bullets");
    value = { title: "Chương mới", scenes: [scene] };
    added = scene;
    chapters.push(value);
    path = ["chapters", chapters.length - 1];
    key = `chapter-${chapters.length}`;
  } else {
    const at = locate(raw, add.chapter ?? "", script);
    if (at.kind !== "chapter") throw new Error(`"${add.chapter}" is not a chapter`);
    if (!add.type) throw new Error("The scene needs a type");
    const scenes = at.part.scenes as unknown[];
    const scene = newScene(raw, add.type);
    scenes.push(scene);
    value = scene;
    added = scene;
    path = [...at.path, "scenes", scenes.length - 1];
    key = scene.id as string;
  }

  const check = validateScriptData(raw);
  if (!check.ok) return { ok: false, errors: [], others: check.errors };
  const out = inserted(text, path, value, raw) ?? relaid(text, raw);
  // the last check, then the script at once: another program's save in between would be overwritten
  if (fingerprint(readScript(project, script)) !== add.version) return changedMeanwhile(script);
  writeInside(project.dir, project.path(script), out);
  // the placeholder image only once the script names it: a conflict or a failed write leaves none, so nothing is
  // ever cleaned up (a file removed by its name could be another program's by then). One that cannot be written
  // leaves the scene without its image, which the storyboard build reports.
  try {
    placeholderImages(project, script, added);
  } catch {
    // the scene is in the script either way
  }
  return { ok: true, version: fingerprint(out), changed: true, key, renamed: renamedKeys(before, raw) };
}

/**
 * Adds a copy of the scene `part.key` names, right after it in its chapter and
 * under an id no scene has. Chapters and the outro have no copy.
 */
export function duplicateScriptPart(project: Project, script: string, part: PartRemoval): SavePartResult {
  const text = readScript(project, script);
  if (fingerprint(text) !== part.version) return changedMeanwhile(script);
  const raw = parse(text, script);
  const at = locate(raw, part.key, script);
  if (at.kind !== "scene") throw new Error("Chỉ nhân bản được cảnh");
  const before = partKeys(raw);
  const copy = JSON.parse(JSON.stringify(at.part)) as Record<string, unknown>;
  copy.id = freshId(raw, `${typeof at.part.id === "string" ? at.part.id : at.key}-copy`);
  const ci = at.path[1] as number;
  const index = (at.path[3] as number) + 1;
  (chaptersOf(raw, script)[ci].scenes as unknown[]).splice(index, 0, copy);

  const check = validateScriptData(raw);
  if (!check.ok) return { ok: false, errors: [], others: check.errors };
  const out = inserted(text, ["chapters", ci, "scenes", index], copy, raw) ?? relaid(text, raw);
  if (fingerprint(readScript(project, script)) !== part.version) return changedMeanwhile(script);
  writeInside(project.dir, project.path(script), out);
  return { ok: true, version: fingerprint(out), changed: true, key: copy.id as string, renamed: renamedKeys(before, raw) };
}

/**
 * Moves a part one place in the script's order: a scene inside its chapter —
 * over the chapter's edge, into the one before or after — or a chapter inside
 * the script. A chapter the scene emptied goes with it. The intro and the
 * outro have no order of their own.
 */
export function moveScriptPart(project: Project, script: string, move: PartMove): SavePartResult {
  const text = readScript(project, script);
  if (fingerprint(text) !== move.version) return changedMeanwhile(script);
  const raw = parse(text, script);
  const at = locate(raw, move.key, script);
  const chapters = chaptersOf(raw, script);
  const before = partKeys(raw);
  const up = move.direction === "up";
  const edge = (): SavePartResult => ({ ok: false, errors: [{ path: "", message: `Phần này đã ở ${up ? "đầu" : "cuối"} — không chuyển được.` }], others: [] });

  let out: string;
  let newKey: string;
  if (at.kind === "chapter") {
    const i = at.path[1] as number;
    const j = i + (up ? -1 : 1);
    if (j < 0 || j >= chapters.length) return edge();
    [chapters[i], chapters[j]] = [chapters[j], chapters[i]];
    newKey = `chapter-${j + 1}`;
    out = swapped(text, ["chapters"], Math.min(i, j), raw) ?? relaid(text, raw);
  } else if (at.kind === "scene") {
    const ci = at.path[1] as number;
    const si = at.path[3] as number;
    const scenes = chapters[ci].scenes as unknown[];
    const j = si + (up ? -1 : 1);
    if (j >= 0 && j < scenes.length) {
      [scenes[si], scenes[j]] = [scenes[j], scenes[si]];
      out = swapped(text, ["chapters", ci, "scenes"], Math.min(si, j), raw) ?? relaid(text, raw);
    } else {
      // over the chapter's edge, into the one before or after
      const dest = ci + (up ? -1 : 1);
      if (dest < 0 || dest >= chapters.length) return edge();
      const destScenes = chapters[dest].scenes as unknown[];
      const scene = scenes.splice(si, 1)[0];
      const index = up ? destScenes.length : 0;
      destScenes.splice(index, 0, scene);
      // a chapter the scene emptied goes with it — the scene was inside it, so it is cut already
      const from = scenes.length ? at.path : (chapters.splice(ci, 1), ["chapters", ci]);
      out = relocated(text, from, ["chapters", dest, "scenes"], index, scene, raw) ?? relaid(text, raw);
    }
    // the key the moved scene is shown under now: its id, else its new place
    newKey = sceneKey(raw, at.part);
  } else {
    return { ok: false, errors: [{ path: "", message: "Phần này không đổi thứ tự được" }], others: [] };
  }

  const check = validateScriptData(raw);
  if (!check.ok) return { ok: false, errors: [], others: check.errors };
  if (fingerprint(readScript(project, script)) !== move.version) return changedMeanwhile(script);
  writeInside(project.dir, project.path(script), out);
  return { ok: true, version: fingerprint(out), changed: true, key: newKey, renamed: renamedKeys(before, raw) };
}

/** The scene types the app may add, as script.json writes them ("code", "news.breaking"): the classic ones first, then the template families. */
export function sceneTypes(): string[] {
  return [...allSchemas().scenes.keys()];
}

/** The script's `chapters` array. */
function chaptersOf(raw: unknown, script: string): Record<string, unknown>[] {
  if (!isObject(raw) || !Array.isArray(raw.chapters)) throw new Error(`${script} has no chapters`);
  return raw.chapters as Record<string, unknown>[];
}

/** An id no scene in the script has, built on `base` ("hook" → "hook-2"…). */
function freshId(raw: unknown, base: string): string {
  const taken = new Set<string>();
  const chapters = isObject(raw) && Array.isArray(raw.chapters) ? (raw.chapters as Record<string, unknown>[]) : [];
  for (const ch of chapters) {
    const scenes = Array.isArray(ch.scenes) ? (ch.scenes as unknown[]) : [];
    for (const s of scenes) if (isObject(s) && typeof s.id === "string") taken.add(s.id);
  }
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** A new scene of `type` (an alias resolves to its classic type), with starter fields and an id of its own. */
function newScene(raw: unknown, type: string): Record<string, unknown> {
  const t = TYPE_ALIASES[type] ?? type;
  const base = SKELETONS[t];
  if (!base) throw new Error(`Unknown scene type ${JSON.stringify(t)}`);
  const scene = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  scene.id = freshId(raw, t.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene");
  return scene;
}

/** The storyboard key `part` stands under in `raw` now: its id, else `s{n}` counted over the scenes as locate() keys them. */
function sceneKey(raw: unknown, part: Record<string, unknown>): string {
  if (typeof part.id === "string") return part.id;
  let n = 0;
  const chapters = isObject(raw) && Array.isArray(raw.chapters) ? (raw.chapters as Record<string, unknown>[]) : [];
  for (const ch of chapters) {
    const scenes = Array.isArray(ch.scenes) ? (ch.scenes as unknown[]) : [];
    for (const s of scenes) {
      n++;
      if (s === part) return `s${n}`;
    }
  }
  return "";
}

/** The key each chapter and scene of `raw` stands under, as locate() keys them, by the object itself. */
function partKeys(raw: unknown): Map<unknown, string> {
  const keys = new Map<unknown, string>();
  const chapters = isObject(raw) && Array.isArray(raw.chapters) ? (raw.chapters as unknown[]) : [];
  let n = 0;
  chapters.forEach((chapter, ci) => {
    if (!isObject(chapter)) return;
    keys.set(chapter, `chapter-${ci + 1}`);
    for (const scene of Array.isArray(chapter.scenes) ? (chapter.scenes as unknown[]) : []) {
      n++;
      if (isObject(scene)) keys.set(scene, typeof scene.id === "string" ? scene.id : `s${n}`);
    }
  });
  return keys;
}

/** The keys that changed since `before` was taken of the same parsed script: old → new, null for a part that is gone. */
function renamedKeys(before: Map<unknown, string>, raw: unknown): Record<string, string | null> | undefined {
  const after = partKeys(raw);
  const renamed: Record<string, string | null> = {};
  for (const [part, key] of before) {
    const now = after.get(part) ?? null;
    if (now !== key) renamed[key] = now;
  }
  return Object.keys(renamed).length ? renamed : undefined;
}

/**
 * The placeholder a new scene's image fields point at, written next to the
 * script so the storyboard builds; never over anything the user has there
 * (a file, or a link, even one to a file not there yet), and looked up inside
 * the project only.
 */
function placeholderImages(project: Project, script: string, scene: Record<string, unknown>): void {
  const fields = SCENE_IMAGE_FIELDS[typeof scene.type === "string" ? scene.type : ""] ?? [];
  const dir = dirname(project.path(script));
  for (const f of fields) {
    const src = scene[f];
    if (src !== PLACEHOLDER_IMAGE) continue;
    const path = join(dir, src);
    // the folders on the way lead inside the project; the name itself is looked at, not followed
    if (resolveInside(project.dir, path) && !lstatSync(path, { throwIfNoEntry: false })) writeInside(project.dir, path, PLACEHOLDER_SVG);
  }
}

/** The placeholder a new image scene points at until the user picks a real file. */
const PLACEHOLDER_IMAGE = "image.svg";
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#2a2f3a"/>
  <rect x="24" y="24" width="1232" height="672" rx="12" fill="none" stroke="#525a6e" stroke-width="3" stroke-dasharray="18 14"/>
  <text x="640" y="350" font-family="sans-serif" font-size="44" fill="#8b93a7" text-anchor="middle">Ảnh mẫu</text>
  <text x="640" y="410" font-family="sans-serif" font-size="28" fill="#6d7488" text-anchor="middle">thay bằng file của bạn trong script.json</text>
</svg>
`;

/** The starter fields a new scene of each type gets: the required ones, filled with text to edit right away. */
const NEW_VOICE = "Lời thoại cho cảnh này.";
const SKELETONS: Record<string, Record<string, unknown>> = {
  statement: { type: "statement", voice: NEW_VOICE, text: "Câu chốt của cảnh" },
  title: { type: "title", voice: NEW_VOICE, title: "Tiêu đề bài học" },
  objectives: { type: "objectives", voice: NEW_VOICE, items: ["Mục tiêu đầu tiên", "Mục tiêu thứ hai"] },
  concept: { type: "concept", voice: NEW_VOICE, term: "Khái niệm", definition: "Định nghĩa ngắn gọn của khái niệm" },
  bullets: { type: "bullets", voice: NEW_VOICE, title: "Nội dung chính", items: ["Ý thứ nhất"] },
  code: { type: "code", voice: NEW_VOICE, lang: "kotlin", code: "// code mẫu" },
  diff: { type: "diff", voice: NEW_VOICE, lang: "kotlin", before: "// trước", after: "// sau" },
  terminal: { type: "terminal", voice: NEW_VOICE, commands: [{ cmd: "echo hello", output: "hello" }] },
  diagram: { type: "diagram", voice: NEW_VOICE, nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] },
  layers: { type: "layers", voice: NEW_VOICE, layers: [{ name: "Tầng trên" }, { name: "Tầng dưới" }] },
  phone: { type: "phone", voice: NEW_VOICE, ui: { appBar: "Ứng dụng" } },
  compare: { type: "compare", voice: NEW_VOICE, columns: ["Cách A", "Cách B"], rows: [{ label: "Tiêu chí", values: ["…", "…"] }] },
  quiz: { type: "quiz", voice: NEW_VOICE, question: "Câu hỏi?", options: ["Đáp án A", "Đáp án B"], answer: 0 },
  recap: { type: "recap", voice: NEW_VOICE, items: ["Ý cần nhớ thứ nhất", "Ý cần nhớ thứ hai"] },
  image: { type: "image", voice: NEW_VOICE, src: PLACEHOLDER_IMAGE },
  "lesson.compare": { type: "lesson.compare", voice: NEW_VOICE, left: { name: "A", rows: [{ label: "Tiêu chí", value: "…" }] }, right: { name: "B", rows: [{ label: "Tiêu chí", value: "…" }] } },
  "news.breaking": { type: "news.breaking", voice: NEW_VOICE, headline: "Tin chính" },
  "news.top-n": { type: "news.top-n", voice: NEW_VOICE, title: "Top N", items: [{ title: "Mục 1" }, { title: "Mục 2" }] },
  "news.quote": { type: "news.quote", voice: NEW_VOICE, quote: "Trích dẫn", person: "Người nói", source: "Nguồn" },
  "news.lower-third": { type: "news.lower-third", voice: NEW_VOICE, media: PLACEHOLDER_IMAGE, tag: "TAG", name: "Tên" },
  "news.globe": { type: "news.globe", voice: NEW_VOICE, headline: "Tiêu đề", markers: [{ lat: 10.8, lon: 106.7, label: "SG", primary: true }] },
  "data.big-number": { type: "data.big-number", voice: NEW_VOICE, value: "42", label: "Nhãn", source: "Nguồn" },
  "data.dumbbell": { type: "data.dumbbell", voice: NEW_VOICE, title: "Kết luận", legend: ["Trước", "Sau"], rows: [{ label: "A", a: 1, b: 3 }, { label: "B", a: 2, b: 4 }], axisMax: 5, source: "Nguồn" },
  "data.line": { type: "data.line", voice: NEW_VOICE, title: "Xu hướng", points: [1, 3, 2], labels: ["A", "B", "C"], source: "Nguồn" },
  "data.waffle": { type: "data.waffle", voice: NEW_VOICE, percent: 42, label: "Nhãn", source: "Nguồn" },
  "data.timeline": { type: "data.timeline", voice: NEW_VOICE, title: "Dòng thời gian", range: [2020, 2025], events: [{ year: 2020, text: "Mốc đầu" }, { year: 2025, text: "Mốc cuối" }] },
  "energy.punch": { type: "energy.punch", voice: NEW_VOICE, punch: "Chốt!" },
  "energy.punch-3d": { type: "energy.punch-3d", voice: NEW_VOICE, punch: "Chốt!" },
  "energy.myth-fact": { type: "energy.myth-fact", voice: NEW_VOICE, myth: "Lầm tưởng phổ biến", fact: "Sự thật đúng" },
  "energy.before-after": { type: "energy.before-after", voice: NEW_VOICE, before: { value: "x1" }, after: { value: "x5" } },
  "energy.big-rank": { type: "energy.big-rank", voice: NEW_VOICE, rank: 1, title: "Tiêu đề" },
  "3d.layers": { type: "3d.layers", voice: NEW_VOICE, layers: [{ name: "Lớp 1" }, { name: "Lớp 2" }] },
  "3d.hero-object": { type: "3d.hero-object", voice: NEW_VOICE, title: "Tiêu đề" },
  "3d.phone": { type: "3d.phone", voice: NEW_VOICE, title: "Tiêu đề" },
};

/** The script's text, from the file it opens inside the project. */
function readScript(project: Project, script: string): string {
  return readInside(project.dir, project.path(script), script).data.toString("utf8");
}

function changedMeanwhile(script: string): SavePartResult {
  return { ok: false, conflict: true, errors: [], others: [{ path: "(file)", message: `${script} changed after the part was read` }] };
}

// ── finding a part ────────────────────────────────────────────────────────

interface Located {
  kind: ScriptPartKind;
  key: string;
  /** where the part is in the script, as error paths start */
  path: (string | number)[];
  part: Record<string, unknown>;
  /** puts the edited part in its place */
  put(next: Record<string, unknown>): void;
}

/** The part the storyboard shows under `key`, keyed as the storyboard keys them (plan.ts buildEntries). */
function locate(raw: unknown, key: string, script: string): Located {
  if (!isObject(raw) || !Array.isArray(raw.chapters)) throw new Error(`${script} has no chapters`);
  const chapters = raw.chapters as unknown[];
  const found: Located[] = [];
  let n = 0;
  chapters.forEach((chapter, ci) => {
    if (!isObject(chapter)) return;
    const scenes = Array.isArray(chapter.scenes) ? (chapter.scenes as unknown[]) : [];
    if (key === `chapter-${ci + 1}`) found.push({ kind: "chapter", key, path: ["chapters", ci], part: chapter, put: (next) => (chapters[ci] = next) });
    scenes.forEach((scene, si) => {
      n++;
      if (!isObject(scene)) return;
      if ((typeof scene.id === "string" ? scene.id : `s${n}`) === key) {
        found.push({ kind: "scene", key, path: ["chapters", ci, "scenes", si], part: scene, put: (next) => (scenes[si] = next) });
      }
    });
  });
  if (key === "intro") {
    // the sting is the brand's, what the script picks is where it plays — absent is "auto"
    const intro: Record<string, unknown> = { intro: typeof raw.intro === "string" ? raw.intro : "auto" };
    found.push({ kind: "intro", key, path: ["intro"], part: intro, put: (next) => (raw.intro = next.intro) });
  }
  if (key === "outro") {
    const had = "outro" in raw;
    const outro = isObject(raw.outro) ? raw.outro : {};
    const put = (next: Record<string, unknown>) => {
      // no outro written and nothing entered: the script keeps its default one
      if (had || Object.keys(next).length) raw.outro = next;
    };
    found.push({ kind: "outro", key, path: ["outro"], part: outro, put });
  }
  if (found.length > 1) throw new Error(`Several parts of ${script} are shown as "${key}": give the scenes ids of their own`);
  if (found[0]) return found[0];
  throw new Error(`${script} has no scene "${key}"`);
}

// ── schemas ───────────────────────────────────────────────────────────────

let schemas: { scenes: Map<string, JsonSchema>; chapter: JsonSchema; intro: JsonSchema; outro: JsonSchema } | undefined;

/** JSON Schemas of each scene type, of a chapter and of the outro, as a script may write them (defaults optional). */
function allSchemas() {
  if (!schemas) {
    const opts = { io: "input", unrepresentable: "any" } as const;
    const union = z.toJSONSchema(SceneSchema, opts) as { oneOf?: JsonSchema[]; anyOf?: JsonSchema[] };
    const scenes = new Map<string, JsonSchema>();
    for (const branch of union.oneOf ?? union.anyOf ?? []) {
      const type = (branch.properties as Record<string, { const?: unknown }> | undefined)?.type?.const;
      if (typeof type === "string") scenes.set(type, branch);
    }
    const script = z.toJSONSchema(LessonScriptSchema, opts) as { properties: Record<string, JsonSchema> };
    // the intro sting itself is the brand's; a part of one field says where it plays
    const intro = { type: "object", properties: { intro: script.properties.intro }, required: ["intro"] };
    schemas = { scenes, chapter: (script.properties.chapters as { items: JsonSchema }).items, intro, outro: script.properties.outro };
  }
  return schemas;
}

function describe(at: Located): Pick<ScriptPart, "type" | "schema" | "advanced"> {
  const all = allSchemas();
  if (at.kind === "chapter") return { type: "chapter", schema: editable(all.chapter, CHAPTER_FIXED, []), advanced: [] };
  if (at.kind === "intro") return { type: "intro", schema: all.intro as ScriptPart["schema"], advanced: [] };
  if (at.kind === "outro") return { type: "outro", schema: editable(all.outro, OUTRO_FIXED, []), advanced: [] };
  const written = at.part.type;
  const type = typeof written === "string" ? (TYPE_ALIASES[written] ?? written) : "";
  const schema = all.scenes.get(type);
  if (!schema) throw new Error(`Scene "${at.key}" has an unknown type ${JSON.stringify(written)}`);
  return { type, schema: editable(schema, SCENE_FIXED, ADVANCED), advanced: ADVANCED };
}

/** The object schema less its fixed fields: the narration first, the advanced fields last. */
function editable(schema: JsonSchema, fixed: string[], advanced: string[]): ScriptPart["schema"] {
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const rank = (k: string) => (k === "voice" ? 0 : advanced.includes(k) ? 2 : 1);
  const names = Object.keys(props)
    .filter((k) => !fixed.includes(k))
    .sort((a, b) => rank(a) - rank(b));
  const required = ((schema.required ?? []) as string[]).filter((k) => names.includes(k));
  return { type: "object", properties: Object.fromEntries(names.map((k) => [k, props[k]])), required };
}

// ── saving ────────────────────────────────────────────────────────────────

/** Problems in the part, relative to it, apart from the rest. */
function byPart(problems: Problem[], at: (string | number)[]): { errors: Problem[]; others: Problem[] } {
  const prefix = at.join(".");
  const errors: Problem[] = [];
  const others: Problem[] = [];
  for (const p of problems) {
    if (p.path === prefix) errors.push({ path: "", message: p.message });
    else if (p.path.startsWith(`${prefix}.`)) errors.push({ path: p.path.slice(prefix.length + 1), message: p.message });
    else others.push(p);
  }
  return { errors, others };
}

/**
 * The script's new text, changed where the part changed and byte for byte as
 * it was elsewhere (the agent's layout, its one-line arrays): the values that
 * changed when the part keeps its fields, else the whole part, else (the part
 * is not in the file yet: an outro left to its default) the whole script laid
 * out afresh.
 */
function edited(text: string, path: (string | number)[], before: Record<string, unknown>, after: Record<string, unknown>, script: unknown): string {
  const { eol, indent } = layoutOf(text);
  // a value's lines continue at the indentation of the line it starts on
  const json = (value: unknown, start: number) => {
    const line = text.slice(text.lastIndexOf("\n", start - 1) + 1, start);
    return JSON.stringify(value, null, indent).replace(/\n/g, eol + /^[ \t]*/.exec(line)![0]);
  };
  const replace = (edits: { span: [number, number] | undefined; value: unknown }[]) => {
    if (edits.some((e) => !e.span)) return undefined;
    let out = text;
    for (const { span, value } of edits.sort((a, b) => b.span![0] - a.span![0])) out = out.slice(0, span![0]) + json(value, span![0]) + out.slice(span![1]);
    return out;
  };
  const sameFields = JSON.stringify(Object.keys(before)) === JSON.stringify(Object.keys(after));
  const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  const attempts = [
    () => (sameFields ? replace(changed.map((k) => ({ span: valueSpan(text, [...path, k]), value: after[k] }))) : undefined),
    () => replace([{ span: valueSpan(text, path), value: after }]),
  ];
  for (const attempt of attempts) {
    const out = attempt();
    if (out !== undefined && parsesTo(out, script)) return out;
  }
  return relaid(text, script);
}

/** `text` parses to exactly `value` — member order aside, which JSON ignores. */
function parsesTo(text: string, value: unknown): boolean {
  try {
    return sameJson(JSON.parse(text), value);
  } catch {
    return false;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && sameJson(a[k], b[k]));
  }
  return a === b;
}

/** How a JSON file is laid out: its line endings and indentation (none when it is all on one line). */
function layoutOf(text: string): { eol: string; indent: string | number | undefined } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (!text.trim().includes("\n")) return { eol, indent: undefined };
  const lead = /\n([ \t]+)\S/.exec(text)?.[1];
  return { eol, indent: lead?.startsWith("\t") ? "\t" : lead?.length || 2 };
}

/**
 * Where the value at `path` is in JSON text that parses: its start and end
 * offsets, the last of duplicate keys as JSON.parse reads them.
 */
export function valueSpan(text: string, path: (string | number)[]): [number, number] | undefined {
  return spanAt(text, path)?.span;
}

/**
 * Where the array element or object member at `path` is in the text: for a
 * member, from the start of its `"key"` — what removing the member cuts out.
 */
function memberSpan(text: string, path: (string | number)[]): [number, number] | undefined {
  const at = spanAt(text, path);
  return at && [at.keyStart ?? at.span[0], at.span[1]];
}

/**
 * The value at `path`: its `span`, and `keyStart` — where the member's `"key"`
 * starts when the path's last step is one of an object's members.
 */
function spanAt(text: string, path: (string | number)[]): { span: [number, number]; keyStart?: number } | undefined {
  let i = 0;
  const space = () => {
    while (i < text.length && " \t\r\n".includes(text[i])) i++;
  };
  // moves past the value at i
  const skip = (): void => {
    space();
    const open = text[i];
    if (open === '"') {
      i++;
      while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
    } else if (open === "{" || open === "[") {
      i++;
      space();
      if (text[i] === (open === "{" ? "}" : "]")) {
        i++;
        return;
      }
      for (;;) {
        if (open === "{") {
          skip();
          space();
          i++; // the colon
        }
        skip();
        space();
        if (text[i++] !== ",") return;
      }
    } else {
      while (i < text.length && !" \t\r\n,]}".includes(text[i])) i++;
    }
  };
  const find = (rest: (string | number)[]): { span: [number, number]; keyStart?: number } | undefined => {
    space();
    if (!rest.length) {
      const start = i;
      skip();
      return { span: [start, i] };
    }
    const [step, ...more] = rest;
    const open = text[i];
    if (open !== (typeof step === "number" ? "[" : "{")) return undefined;
    i++;
    space();
    if (text[i] === "]" || text[i] === "}") return undefined;
    let found: { span: [number, number]; keyStart?: number } | undefined;
    for (let n = 0; ; n++) {
      let here = typeof step === "number" && n === step;
      let keyStart: number | undefined;
      if (open === "{") {
        keyStart = i;
        skip();
        here = JSON.parse(text.slice(keyStart, i)) === step;
        space();
        i++; // the colon
      }
      space();
      const valueStart = i;
      if (here) {
        const inner = find(more);
        // at the leaf, the member's key belongs to the span; above it, the leaf's own result comes up unchanged
        if (inner) found = more.length ? inner : { span: inner.span, keyStart };
        i = valueStart;
      }
      skip();
      space();
      if (text[i++] !== ",") return found;
    }
  };
  return find(path);
}

/**
 * The script's text with the array element or object member at `path` — and
 * one of its commas — cut out, the rest byte for byte as it was; the whole
 * script laid out afresh when the member cannot be located.
 */
function removed(text: string, path: (string | number)[], script: unknown): string {
  const span = cutSpan(text, path);
  const out = span && text.slice(0, span[0]) + text.slice(span[1]);
  if (out !== undefined && parsesTo(out, script)) return out;
  return relaid(text, script);
}

/**
 * The region cutting the array element or object member at `path` takes out:
 * the member and one of its commas, with the whitespace that line spent on it.
 */
function cutSpan(text: string, path: (string | number)[]): [number, number] | undefined {
  const span = memberSpan(text, path);
  if (!span) return undefined;
  const [s, e] = span;
  let i = e;
  while (i < text.length && " \t\r\n".includes(text[i])) i++;
  if (text[i] === ",") {
    // a later element follows: the member's own line's whitespace goes with it
    let start = s;
    while (start > 0 && " \t".includes(text[start - 1])) start--;
    if (text[start - 1] === "\n") start--;
    if (text[start - 1] === "\r") start--;
    return [start, i + 1];
  }
  // the last one: the comma and the whitespace between it and the member go too
  let j = s;
  while (j > 0 && " \t\r\n".includes(text[j - 1])) j--;
  if (text[j - 1] !== ",") return undefined;
  let end = e;
  while (end < text.length && " \t".includes(text[end])) end++;
  return [j - 1, end];
}

/** A splice of `text`: `span` becomes `put`. */
interface Splice {
  span: [number, number];
  put: string;
}

/**
 * The script's text with `value` as element `index` of the array at
 * `arrayPath` — the new element laid out as the array lays out its own
 * (multi-line under the sibling's indent, or compact inside a one-line array).
 * `undefined` when it cannot be placed.
 */
function inserted(text: string, path: (string | number)[], value: unknown, script: unknown): string | undefined {
  const ins = insertEdit(text, path.slice(0, -1), path[path.length - 1] as number, value);
  if (!ins) return undefined;
  const out = text.slice(0, ins.span[0]) + ins.put + text.slice(ins.span[1]);
  return parsesTo(out, script) ? out : undefined;
}

/**
 * The script's text with the element at `from` cut out and `value` put at
 * `to[index]` — one pass over both splices, the one further right first.
 */
function relocated(text: string, from: (string | number)[], to: (string | number)[], index: number, value: unknown, script: unknown): string | undefined {
  const cut = cutSpan(text, from);
  const ins = insertEdit(text, to, index, value);
  if (!cut || !ins) return undefined;
  let out = text;
  for (const { span, put } of [{ span: cut, put: "" }, ins].sort((a, b) => b.span[0] - a.span[0])) {
    out = out.slice(0, span[0]) + put + out.slice(span[1]);
  }
  return parsesTo(out, script) ? out : undefined;
}

/** The script's text with the array's elements `i` and `i+1` traded, the rest byte for byte. */
function swapped(text: string, arrayPath: (string | number)[], i: number, script: unknown): string | undefined {
  const a = memberSpan(text, [...arrayPath, i]);
  const b = memberSpan(text, [...arrayPath, i + 1]);
  if (!a || !b) return undefined;
  const out = text.slice(0, a[0]) + text.slice(b[0], b[1]) + text.slice(a[1], b[0]) + text.slice(a[0], a[1]) + text.slice(b[1]);
  return parsesTo(out, script) ? out : undefined;
}

/** The splice putting `value` into the array at `arrayPath` before its element `index` (index past the end appends). */
function insertEdit(text: string, arrayPath: (string | number)[], index: number, value: unknown): Splice | undefined {
  const { eol, indent } = layoutOf(text);
  const span = valueSpan(text, arrayPath);
  if (!span || text[span[0]] !== "[") return undefined;
  const inner = text.slice(span[0] + 1, span[1] - 1);
  const multi = inner.includes("\n");
  const json = (col: string) => (multi ? JSON.stringify(value, null, indent).replace(/\n/g, eol + col) : JSON.stringify(value));
  const pad = (ws: string) => ws.slice(ws.lastIndexOf("\n") + 1);
  if (index > 0) {
    // after the element above: its comma first, then separated as the file separates
    const prev = memberSpan(text, [...arrayPath, index - 1]);
    if (!prev) return undefined;
    const col = pad(wsBefore(text, prev[0]));
    return { span: [prev[1], prev[1]], put: (multi ? `,${eol}${col}` : `,${wsBefore(text, prev[0]) || " "}`) + json(col) };
  }
  const next = memberSpan(text, [...arrayPath, 0]);
  if (!next) return inner.trim() ? undefined : { span: [span[0] + 1, span[0] + 1], put: json("") };
  const col = pad(wsBefore(text, next[0]));
  return { span: [next[0], next[0]], put: multi ? `${json(col)},${eol}${col}` : `${json("")},${wsBefore(text, next[0]) || " "}` };
}

/** The whitespace run right before `pos` — a member's leading whitespace and indent. */
function wsBefore(text: string, pos: number): string {
  let i = pos;
  while (i > 0 && " \t\r\n".includes(text[i - 1])) i--;
  return text.slice(i, pos);
}

/** The whole script laid out afresh, keeping the file's own indent and line endings. */
function relaid(text: string, script: unknown): string {
  const { eol, indent } = layoutOf(text);
  const whole = JSON.stringify(script, null, indent).replace(/\n/g, eol);
  return /\n$/.test(text) ? whole + eol : whole;
}

/**
 * The text with `key: value` inside the object at `path` (`[]` = the script
 * itself): the member's value replaced when it is there, else inserted as
 * the object's first member on a line of its own. `undefined` when it cannot
 * be placed (the object missing, or the result no longer the same script).
 */
function memberSet(text: string, path: (string | number)[], key: string, value: unknown, script: unknown): string | undefined {
  const { eol } = layoutOf(text);
  const member = valueSpan(text, [...path, key]);
  if (member) {
    const out = text.slice(0, member[0]) + JSON.stringify(value) + text.slice(member[1]);
    return parsesTo(out, script) ? out : undefined;
  }
  const obj = valueSpan(text, path);
  if (!obj || text[obj[0]] !== "{") return undefined;
  let first = obj[0] + 1;
  while (first < obj[1] && " \t\r\n".includes(text[first])) first++;
  if (text[first] === "}") {
    const out = `${text.slice(0, obj[0] + 1)}${JSON.stringify(key)}: ${JSON.stringify(value)}${text.slice(first)}`;
    return parsesTo(out, script) ? out : undefined;
  }
  // a member line of its own, indented as the object's members are
  const line = text.lastIndexOf("\n", first - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(line, first))![0];
  const insert = `${eol}${indent}${JSON.stringify(key)}: ${JSON.stringify(value)},${eol}${indent}`;
  const out = `${text.slice(0, obj[0] + 1)}${insert}${text.slice(first)}`;
  return parsesTo(out, script) ? out : undefined;
}

function parse(text: string, script: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${script} is not valid JSON: ${(e as Error).message}`);
  }
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
