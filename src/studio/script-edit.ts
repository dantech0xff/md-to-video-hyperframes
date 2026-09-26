/**
 * Editing one part of a script by hand, as the desktop app's storyboard review
 * does without the agent: a scene, a chapter card or the outro, found by the
 * key the storyboard shows it under ("hook", "s3", "chapter-2", "outro").
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
import { z } from "zod";
import { common } from "../lesson/schema-common.js";
import { TYPE_ALIASES } from "../lesson/schema-templates.js";
import { LessonScriptSchema, SceneSchema } from "../lesson/schema.js";
import { readInside, writeInside } from "../utils/inside.js";
import type { Project } from "./project.js";
import { validateScriptData, type Problem } from "./tools.js";

/** A JSON Schema (draft 2020-12), as plain JSON. */
export type JsonSchema = { [keyword: string]: unknown };

export type ScriptPartKind = "scene" | "chapter" | "outro";

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

export type SavePartResult =
  | { ok: true; version: string; changed: boolean }
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
/** The storyboard shows a chapter's card, not its scenes; whether the card shows stays with the agent. */
const CHAPTER_FIXED = ["scenes", "card"];
const OUTRO_FIXED = ["enabled"];
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
  const out = edited(text, at.path, at.part, next, raw);
  // another program (an editor, something the agent left running) may have written the script meanwhile:
  // checked again right before the new file takes its place
  if (fingerprint(readScript(project, script)) !== edit.version) return changedMeanwhile(script);
  writeInside(project.dir, project.path(script), out);
  return { ok: true, version: fingerprint(out), changed: true };
}

/** The script's text, from the file it opens inside the project. */
function readScript(project: Project, script: string): string {
  return readInside(project.dir, project.path(script), script).toString("utf8");
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
  if (key === "intro") throw new Error("The intro is the brand's sting: it has nothing to edit");
  throw new Error(`${script} has no scene "${key}"`);
}

// ── schemas ───────────────────────────────────────────────────────────────

let schemas: { scenes: Map<string, JsonSchema>; chapter: JsonSchema; outro: JsonSchema } | undefined;

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
    schemas = { scenes, chapter: (script.properties.chapters as { items: JsonSchema }).items, outro: script.properties.outro };
  }
  return schemas;
}

function describe(at: Located): Pick<ScriptPart, "type" | "schema" | "advanced"> {
  const all = allSchemas();
  if (at.kind === "chapter") return { type: "chapter", schema: editable(all.chapter, CHAPTER_FIXED, []), advanced: [] };
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
  const whole = JSON.stringify(script, null, indent).replace(/\n/g, eol);
  return /\n$/.test(text) ? whole + eol : whole;
}

function parsesTo(text: string, value: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
  } catch {
    return false;
  }
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
  const find = (rest: (string | number)[]): [number, number] | undefined => {
    space();
    if (!rest.length) {
      const start = i;
      skip();
      return [start, i];
    }
    const [step, ...more] = rest;
    const open = text[i];
    if (open !== (typeof step === "number" ? "[" : "{")) return undefined;
    i++;
    space();
    if (text[i] === "]" || text[i] === "}") return undefined;
    let found: [number, number] | undefined;
    for (let n = 0; ; n++) {
      let here = typeof step === "number" && n === step;
      if (open === "{") {
        const keyStart = i;
        skip();
        here = JSON.parse(text.slice(keyStart, i)) === step;
        space();
        i++; // the colon
      }
      space();
      const valueStart = i;
      if (here) {
        found = find(more);
        i = valueStart;
      }
      skip();
      space();
      if (text[i++] !== ",") return found;
    }
  };
  return find(path);
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
