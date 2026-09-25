import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";
import { hyperframesCli, hyperframesEnv, killTree, nodeBin } from "../utils/binaries.js";

export interface RenderArgs {
  compositionDir: string;  // path to composition directory
  outputPath: string;      // path for .mp4
  fps?: number;            // default 30
  quality?: "draft" | "standard" | "high"; // default "standard"
  /** encoder CRF override (lower = bigger/better); omit to use the quality preset */
  crf?: number;
  workers?: number;
  /** HyperFrames' own progress: percent (0–100) and the stage it is in */
  onProgress?: (percent: number, stage: string) => void;
  /** aborting stops the render (and its Chrome/FFmpeg children) and rejects with the signal's reason */
  signal?: AbortSignal;
}

export async function renderWithHyperframes(args: RenderArgs): Promise<void> {
  const { compositionDir, outputPath, fps = 30, quality = "standard", signal } = args;
  signal?.throwIfAborted();

  const cliArgs = [
    hyperframesCli(),
    "render",
    compositionDir,
    "--output",
    outputPath,
    "--fps",
    String(fps),
    "--quality",
    quality,
    ...(args.crf !== undefined ? ["--crf", String(args.crf)] : []),
    ...(args.workers !== undefined ? ["--workers", String(args.workers)] : []),
  ];

  await new Promise<void>((resolve, reject) => {
    // the locked CLI, run by this Node (Electron's inside the desktop app): no npx, no shell
    const proc = spawn(nodeBin(), cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: hyperframesEnv(),
      windowsHide: true,
    });
    const readProgress = progressReader(args.onProgress);
    proc.stdout.on("data", (d: Buffer) => {
      process.stdout.write(d);
      readProgress(d.toString());
    });
    proc.stderr.on("data", (d: Buffer) => process.stderr.write(d));

    const abort = () => killTree(proc);
    signal?.addEventListener("abort", abort, { once: true });
    proc.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      reject(err);
    });
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new Error(`hyperframes render failed with exit code ${code}`));
    });
  });

  log.info(`Rendered: ${outputPath}`);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Reads HyperFrames' progress line out of its stdout. The CLI redraws one line
 * with `\r` ("  ██████░░░░  42%  Capturing frames"), so every complete segment
 * between `\r`/`\n` is parsed; repeats are skipped.
 */
export function progressReader(onProgress?: (percent: number, stage: string) => void): (chunk: string) => void {
  let pending = "";
  let last = "";
  return (chunk) => {
    if (!onProgress) return;
    const parts = (pending + chunk).split(/[\r\n]/);
    pending = parts.pop() ?? "";
    for (const part of parts) {
      const m = /(\d{1,3})%\s*(.*)$/.exec(part.replace(ANSI, "").trim());
      if (!m) continue;
      const percent = Math.min(100, Number(m[1]));
      const stage = m[2].trim();
      const key = `${percent}|${stage}`;
      if (key === last) continue;
      last = key;
      onProgress(percent, stage);
    }
  };
}
