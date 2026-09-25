#!/usr/bin/env node
/**
 * npm run examples:check [-- examples/lessons/<name> …]
 *
 * Validates every example lesson against the script schema, then composes it
 * and captures its storyboard in Chrome for each of its formats, with
 * estimated timings and no TTS (the same path as `npm run lesson:frames`).
 * Strict: a script error while seeking or a blank 3D layer fails the check.
 * Used by CI; the storyboards land in each example's landscape/ and portrait/.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadLessonScript, runLessonPipeline } from "../src/lesson/pipeline.js";
import { log } from "../src/utils/logger.js";

const ROOT = resolve("examples/lessons");

function examples(args: string[]): string[] {
  const dirs = args.length ? args.map((a) => resolve(a)) : readdirSync(ROOT).map((d) => join(ROOT, d));
  return dirs.map((d) => join(d, "script.json")).filter((f) => existsSync(f));
}

async function main() {
  const scripts = examples(process.argv.slice(2));
  if (!scripts.length) throw new Error("no example scripts found");
  const failures: string[] = [];

  // 1) schema: every script, before spending time in Chrome
  for (const file of scripts) {
    try {
      await loadLessonScript(file);
    } catch (e) {
      failures.push(`${file}\n${(e as Error).message}`);
    }
  }
  if (failures.length) throw new Error(`invalid example scripts:\n${failures.join("\n")}`);
  log.info(`${scripts.length} example scripts are valid`);

  // 2) compose + storyboard in Chrome, every format the script declares
  for (const file of scripts) {
    try {
      const res = await runLessonPipeline(file, { frames: true, strict: true });
      for (const o of res.outputs) log.info(`  ok ${o.format}: ${o.storyboard}`);
    } catch (e) {
      failures.push(`${file}: ${(e as Error).message}`);
      log.error(`  failed: ${file}`);
    }
  }
  if (failures.length) throw new Error(`examples failed to render:\n${failures.join("\n")}`);
  log.info(`all ${scripts.length} examples rendered`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
