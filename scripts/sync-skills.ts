#!/usr/bin/env node
/**
 * npm run skills:sync    copy .agents/skills (the source) to .claude/skills and refresh the
 *                        example scripts bundled with create-lesson-video
 * npm run skills:check   the same comparison without writing; exits 1 when anything is stale (CI)
 *
 * Codex, Devin, Antigravity and Gemini CLI read .agents/skills; Claude Code reads .claude/skills.
 * Both get the same agent-neutral text. Copies, not symlinks: Git on Windows checks symlinks
 * out as plain files.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SOURCE = ".agents/skills";
const MIRROR = ".claude/skills";

/** Examples copied into the lesson skill, so it is complete outside the repo (e.g. in a Get Frames project). */
const EXAMPLES: [from: string, to: string][] = [
  ["examples/lessons/repository-pattern/script.json", join(SOURCE, "create-lesson-video", "reference", "example-lesson.json")],
  ["examples/lessons/short-launch-vs-async/script.json", join(SOURCE, "create-lesson-video", "reference", "example-short.json")],
];

const check = process.argv.includes("--check");
const stale: string[] = [];

function put(to: string, content: Buffer): void {
  if (existsSync(to) && readFileSync(to).equals(content)) return;
  stale.push(to);
  if (check) return;
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, content);
}

function files(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(root, join(dir, e.name)) : [relative(root, join(dir, e.name))],
  );
}

for (const [from, to] of EXAMPLES) put(to, readFileSync(from));

const wanted = new Set(files(SOURCE));
for (const f of wanted) put(join(MIRROR, f), readFileSync(join(SOURCE, f)));
for (const f of existsSync(MIRROR) ? files(MIRROR) : []) {
  if (wanted.has(f)) continue;
  stale.push(join(MIRROR, f));
  if (!check) rmSync(join(MIRROR, f));
}

if (check && stale.length) {
  console.error(`Skills are out of sync, run \`npm run skills:sync\`:\n${stale.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(stale.length ? `updated ${stale.length} file(s):\n${stale.map((f) => `  ${f}`).join("\n")}` : "skills in sync");
