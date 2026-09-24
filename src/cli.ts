#!/usr/bin/env node
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { runPipeline } from "./pipeline.js";
import { runLessonPipeline } from "./lesson/pipeline.js";
import { log } from "./utils/logger.js";

/** Lesson scripts (schema v2) carry `"version": "2.0"`; everything else is a news script. */
function isLessonScript(path: string): boolean {
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { version?: unknown }).version === "2.0";
  } catch {
    return false;
  }
}

async function main() {
  const scriptPath = process.argv[2];
  if (!scriptPath) {
    console.error("Usage: npm run pipeline -- <path/to/script.json>   (lesson scripts: npm run lesson -- <script.json>)");
    process.exit(2);
  }
  try {
    if (isLessonScript(scriptPath)) {
      log.info("Lesson script (version 2.0) → lesson pipeline (npm run lesson has more options)");
      await runLessonPipeline(scriptPath, {});
    } else {
      await runPipeline(scriptPath);
    }
  } catch (e) {
    log.error("Pipeline failed", e);
    process.exit(1);
  }
}

main();
