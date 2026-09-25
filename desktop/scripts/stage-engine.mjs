#!/usr/bin/env node
/**
 * Copies the built engine into desktop/.engine/engine, which electron-builder
 * ships as resources/engine (design doc §10): dist/, assets/, the shipped
 * skills and the engine's production dependencies, installed from its
 * lockfile. Run `npm run build` in the repo root first. (One level down:
 * electron-builder never copies a node_modules at the top of extraResources.)
 *
 * Parts of dependencies the engine never loads are removed to keep the app
 * small (lucide-static and simple-icons are read from icons/, three from
 * build/three.cjs). The smoke test builds a layout with icons, code and the
 * packaged engine, so a file pruned by mistake fails CI.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "..");
const staging = join(desktop, ".engine");
const out = join(staging, "engine");

if (!existsSync(join(root, "dist", "studio", "engine.js"))) {
  console.error("The engine is not built: run `npm run build` in the repo root first.");
  process.exit(1);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// generated locally, never shipped: starter sounds (the app makes its own in its data folder)
const skip = new Set([join(root, "assets", "sfx", "_starter"), join(root, "assets", "music", "_starter")]);
for (const item of ["package.json", "package-lock.json", "LICENSE", "dist", "assets", ".agents/skills"]) {
  cpSync(join(root, item), join(out, item), { recursive: true, filter: (src) => !skip.has(src) && !src.endsWith(".DS_Store") });
}

const npm = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: out,
  stdio: "inherit",
  // npm is npm.cmd on Windows, which only starts through a shell
  shell: process.platform === "win32",
});
if (npm.status !== 0) process.exit(npm.status ?? 1);

// the engine finds these packages through their main file, which stays
const prune = [
  "node_modules/lucide-static/dist/esm",
  "node_modules/lucide-static/dist/cjs/lucide-static.js.map",
  "node_modules/lucide-static/dist/lucide-static.d.ts",
  "node_modules/lucide-static/font",
  "node_modules/lucide-static/sprite.svg",
  "node_modules/lucide-static/icon-nodes.json",
  "node_modules/lucide-static/tags.json",
  "node_modules/simple-icons/index.mjs",
  "node_modules/three/examples",
  "node_modules/three/src",
];
for (const p of prune) rmSync(join(out, p), { recursive: true, force: true });

console.log(`Engine staged in ${relative(desktop, out)}: ${(size(out) / 1024 / 1024).toFixed(0)} MB`);

function size(p) {
  const st = statSync(p);
  return st.isDirectory() ? readdirSync(p).reduce((n, e) => n + size(join(p, e)), 0) : st.size;
}
