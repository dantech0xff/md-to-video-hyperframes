/**
 * External programs the engine runs: FFmpeg, ffprobe and the HyperFrames CLI.
 *
 * Each one can be pinned to an explicit file through an environment variable
 * (the desktop app ships its own); otherwise ffmpeg/ffprobe come from PATH and
 * HyperFrames resolves to the version locked in package.json. No shell and no
 * npx, so the same calls work on macOS, Linux and Windows.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** `FFMPEG_PATH`, else `ffmpeg` from PATH. */
export const ffmpegBin = (): string => process.env.FFMPEG_PATH || "ffmpeg";

/** `FFPROBE_PATH`, else `ffprobe` from PATH. */
export const ffprobeBin = (): string => process.env.FFPROBE_PATH || "ffprobe";

/** Entry script of the pinned HyperFrames CLI, run with `process.execPath`; `HYPERFRAMES_CLI` overrides it. */
export function hyperframesCli(): string {
  if (process.env.HYPERFRAMES_CLI) return process.env.HYPERFRAMES_CLI;
  const pkgFile = require.resolve("hyperframes/package.json");
  const { bin } = JSON.parse(readFileSync(pkgFile, "utf8")) as { bin: string | Record<string, string> };
  return join(dirname(pkgFile), typeof bin === "string" ? bin : bin.hyperframes);
}

/**
 * Environment for a HyperFrames child process: no telemetry, no update check
 * and no background self-install (keeps the locked version), Electron's binary
 * runs as plain Node, and the FFmpeg we were given comes first on PATH because
 * HyperFrames looks `ffmpeg` up there.
 */
export function hyperframesEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    HYPERFRAMES_NO_TELEMETRY: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    HYPERFRAMES_NO_AUTO_INSTALL: "1",
    ELECTRON_RUN_AS_NODE: "1",
  };
  const dirs = [base.FFMPEG_PATH, base.FFPROBE_PATH].filter((p): p is string => !!p).map((p) => dirname(p));
  return dirs.length ? prependPath(env, [...new Set(dirs)]) : env;
}

/** Put directories in front of PATH, whatever case the key has (Windows uses `Path`). */
export function prependPath(env: NodeJS.ProcessEnv, dirs: string[]): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: [...dirs, env[key]].filter(Boolean).join(delimiter) };
}

/** Stop a child process and what it started (Chrome workers, encoders). */
export function killTree(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => proc.kill());
  } else {
    proc.kill("SIGTERM");
  }
}
