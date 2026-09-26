/**
 * The script edit form against the engine's own schema: every field of every
 * part of the reference scripts gets an input, and every value a shape.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JsonSchema } from "../shared/types";
import { blank, branchOf, childPath, fieldKind } from "../renderer/src/lib/schema-form";
import { loadEngine } from "./service";

const ENGINE = resolve(__dirname, "..", "..", "..");
const built = existsSync(join(ENGINE, "dist", "studio", "engine.js"));
const SCRIPTS = [
  "examples/lessons/templates-showcase/script.json",
  "examples/lessons/repository-pattern/script.json",
  "examples/lessons/demo-3d-architecture/script.json",
  "examples/lessons/demo-news-weekly/script.json",
  "examples/lessons/demo-short-coroutines/script.json",
  "examples/lessons/short-launch-vs-async/script.json",
  ".agents/skills/create-lesson-video/reference/example-lesson.json",
  ".agents/skills/create-lesson-video/reference/example-news.json",
  ".agents/skills/create-lesson-video/reference/example-short.json",
];

describe.skipIf(!built)("schema form on the engine's schema", () => {
  /** Problems with a schema and the value it holds: a field with no input, a value no shape of a union takes, a blank that does not fit. */
  function check(schema: JsonSchema, value: unknown, path: string, out: string[]): void {
    const kind = fieldKind(schema, path.split(".").at(-1));
    if (kind.kind === "json") out.push(`${path}: no input for ${JSON.stringify(schema).slice(0, 80)}`);
    if (kind.kind === "union") {
      if (branchOf(kind.branches, blank(schema)) < 0) out.push(`${path}: its blank fits no shape`);
      kind.branches.forEach((b, i) => check(b, value !== undefined && branchOf(kind.branches, value) === i ? value : undefined, `${path}|${i}`, out));
      if (value !== undefined && branchOf(kind.branches, value) < 0) out.push(`${path}: ${JSON.stringify(value)} fits no shape`);
    } else if (kind.kind === "list") {
      check(kind.item, undefined, `${path}[]`, out);
      if (Array.isArray(value)) value.forEach((v, i) => check(kind.item, v, `${path}.${i}`, out));
    } else if (kind.kind === "tuple") {
      kind.items.forEach((item, i) => check(item, Array.isArray(value) ? value[i] : undefined, `${path}.${i}`, out));
    } else if (kind.kind === "object") {
      for (const [name, s] of Object.entries(kind.properties)) {
        check(s, value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined, childPath(path, name), out);
      }
    }
  }

  it("has an input for every field of every part of the reference scripts, and a shape for every value", async () => {
    const engine = await loadEngine(ENGINE);
    const types = new Set<string>();
    const problems: string[] = [];
    for (const file of SCRIPTS) {
      const project = new engine.Project(join(ENGINE, file, ".."));
      const script = file.split("/").at(-1)!;
      const { scenes } = await engine.storyboardReview(project.path(script), "portrait");
      for (const { key, kind } of scenes) {
        if (kind === "intro") continue;
        const part = engine.readScriptPart(project, script, key);
        types.add(part.type);
        for (const [name, schema] of Object.entries(part.schema.properties)) check(schema as JsonSchema, part.value[name], `${file}#${key}.${name}`, problems);
      }
    }
    expect(problems).toEqual([]);
    // the showcase and the examples hold most scene types, template ones included
    expect(types.size).toBeGreaterThan(25);
    expect([...types].filter((t) => t.includes("."))).toEqual(expect.arrayContaining(["news.breaking", "data.big-number", "energy.punch", "3d.phone"]));
  });
});
