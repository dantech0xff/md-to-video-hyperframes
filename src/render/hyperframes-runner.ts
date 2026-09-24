import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";

export interface RenderArgs {
  compositionDir: string;  // path to composition directory
  outputPath: string;      // path for .mp4
  fps?: number;            // default 30
  quality?: "draft" | "standard" | "high"; // default "standard"
  /** encoder CRF override (lower = bigger/better); omit to use the quality preset */
  crf?: number;
  workers?: number;
}

export async function renderWithHyperframes(args: RenderArgs): Promise<void> {
  const { compositionDir, outputPath, fps = 30, quality = "standard" } = args;

  const spawnArgs = [
    "hyperframes",
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
    const proc = spawn("npx", spawnArgs, {
      stdio: ["ignore", "inherit", "inherit"],
      shell: true,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `hyperframes render failed with exit code ${code}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });

  log.info(`Rendered: ${outputPath}`);
}
