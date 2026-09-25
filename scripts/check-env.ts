#!/usr/bin/env node
/**
 * npm run env:check
 *
 * Checks that this machine can run the pipeline: Node version, the external
 * tools (ffmpeg, ffprobe, the HyperFrames CLI), that `.env.example` passes the
 * config validation, and that the bundled brand kit and style packs load.
 * Chrome is only reported: renders fall back to HyperFrames' managed browser.
 * Exits 1 when a required check fails. Used by CI.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { loadConfig } from "../src/config.js";
import { loadBrand } from "../src/lesson/brand.js";
import { listStyles, loadStyle } from "../src/lesson/styles.js";
import { findChrome } from "../src/lesson/storyboard.js";

const MIN_NODE = 22;
const failures: string[] = [];

function check(name: string, fn: () => string) {
  try {
    console.log(`ok   ${name}: ${fn()}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures.push(name);
  }
}

function tool(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`\`${cmd} ${args.join(" ")}\` failed${r.error ? `: ${r.error.message}` : ""}`);
  return (r.stdout || r.stderr).split("\n")[0].trim();
}

check("node", () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE) throw new Error(`v${process.versions.node}, need >= ${MIN_NODE}`);
  return `v${process.versions.node}`;
});
check("ffmpeg", () => tool("ffmpeg", ["-version"]));
check("ffprobe", () => tool("ffprobe", ["-version"]));
check("hyperframes", () => {
  const bin = resolve("node_modules/.bin/hyperframes");
  if (!existsSync(bin)) throw new Error("not installed, run npm ci");
  return tool(bin, ["--version"]);
});

check(".env.example", () => {
  const vars = parse(readFileSync(".env.example"));
  const saved = { ...process.env };
  try {
    Object.assign(process.env, vars);
    const cfg = loadConfig();
    return `valid (TTS_PROVIDER=${cfg.ttsProvider}, VOICE_PROFILE=${cfg.voiceProfile})`;
  } finally {
    process.env = saved;
  }
});
check("config", () => `loads from the current environment (TTS_PROVIDER=${loadConfig().ttsProvider})`);

check("brand dan-tech", () => loadBrand("dan-tech").name);
for (const id of listStyles()) check(`style ${id}`, () => loadStyle(id).name);

const chrome = findChrome();
console.log(`info chrome: ${chrome ?? "not found (renders use HyperFrames' managed browser)"}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nenvironment ok");
