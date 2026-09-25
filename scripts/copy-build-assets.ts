#!/usr/bin/env node
/**
 * Part of `npm run build`: tsc only emits JavaScript, but the engine also
 * loads files that sit next to its sources at runtime (the lesson runtime
 * and its CSS, style packs, the news templates and blocks). Copy every
 * non-TypeScript file from src/ to the same place under dist/, so the
 * compiled engine runs with plain Node (and inside the desktop app).
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SRC = "src";
const OUT = "dist";

function copyAssets(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const from = join(dir, e.name);
    if (e.isDirectory()) n += copyAssets(from);
    else if (!e.name.endsWith(".ts")) {
      const to = join(OUT, relative(SRC, from));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      n++;
    }
  }
  return n;
}

console.log(`copied ${copyAssets(SRC)} runtime assets from ${SRC}/ to ${OUT}/`);
