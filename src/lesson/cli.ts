#!/usr/bin/env node
/**
 * npm run lesson -- <script.json> [options]
 *
 *   --format landscape|portrait|all   render only these formats (default: script.formats)
 *   --style <id>                      override the style pack (dantech, blueprint, whiteboard, terminal)
 *   --storyboard                      compose + storyboard.jpg only, no video (fast review)
 *   --frames                          layout check: estimated timings, no TTS/audio, storyboard only
 *   --no-storyboard                   skip the storyboard
 *   --draft | --high                  render quality (default standard)
 *   --fps 60                          frame rate (default 30)
 *   --preview 20:35                   quick preview.mp4 of 20s→35s (with audio) instead of the full render
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { runLessonPipeline, type LessonRunOptions } from "./pipeline.js";
import { log } from "../utils/logger.js";
import type { FormatName } from "./schema.js";

function parseArgs(argv: string[]): { script?: string; opts: LessonRunOptions } {
  const opts: LessonRunOptions = {};
  let script: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") {
      const v = argv[++i];
      opts.formats = v === "all" ? ["landscape", "portrait"] : (v.split(",") as FormatName[]);
    } else if (a === "--style") opts.style = argv[++i];
    else if (a === "--storyboard") opts.storyboardOnly = true;
    else if (a === "--frames") opts.frames = true;
    else if (a === "--no-storyboard") opts.noStoryboard = true;
    else if (a === "--draft") opts.quality = "draft";
    else if (a === "--high") opts.quality = "high";
    else if (a === "--fps") opts.fps = Number(argv[++i]);
    else if (a === "--crf") opts.crf = Number(argv[++i]);
    else if (a === "--preview") {
      const [from, to] = argv[++i].split(":").map(Number);
      opts.preview = { from, to };
      opts.noStoryboard = true;
    }
    else if (!a.startsWith("--")) script = a;
  }
  return { script, opts };
}

async function main() {
  const { script, opts } = parseArgs(process.argv.slice(2));
  if (!script) {
    console.error("Usage: npm run lesson -- <path/to/script.json> [--format all] [--style dantech] [--storyboard] [--draft]");
    process.exit(2);
  }
  try {
    const res = await runLessonPipeline(script, opts);
    console.log("\n=== Lesson ===");
    for (const o of res.outputs) {
      console.log(`[${o.format}] ${o.duration.toFixed(1)}s`);
      if (o.video) console.log(`  video:      ${o.video}`);
      if (o.storyboard) console.log(`  storyboard: ${o.storyboard}`);
      console.log(`  subtitles:  ${o.dir}/captions.srt · chapters: ${o.dir}/chapters.txt`);
    }
  } catch (e) {
    log.error("Lesson pipeline failed", e);
    process.exit(1);
  }
}

main();
