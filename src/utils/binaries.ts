/**
 * External programs the engine runs: FFmpeg, ffprobe and the HyperFrames CLI.
 *
 * Each one can be pinned to an explicit file through an environment variable
 * (the desktop app ships its own); otherwise ffmpeg/ffprobe come from PATH and
 * HyperFrames resolves to the version locked in package.json. No shell and no
 * npx, so the same calls work on macOS, Linux and Windows.
 */
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** `FFMPEG_PATH`, else `ffmpeg` from PATH. */
export const ffmpegBin = (): string => process.env.FFMPEG_PATH || "ffmpeg";

/** `FFPROBE_PATH`, else `ffprobe` from PATH. */
export const ffprobeBin = (): string => process.env.FFPROBE_PATH || "ffprobe";

/**
 * The Node that runs the HyperFrames CLI: `HYPERFRAMES_NODE`, else this
 * process's executable. The desktop app points it at its main executable,
 * because the engine runs in an Electron utility process whose executable is
 * a helper.
 */
export const nodeBin = (): string => process.env.HYPERFRAMES_NODE || process.execPath;

/** Entry script of the pinned HyperFrames CLI, run with `nodeBin()`; `HYPERFRAMES_CLI` overrides it. */
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

/** First line of `<bin> -version`, e.g. "ffmpeg version 7.1 Copyright (c)…"; rejects when the program cannot run. */
export function toolVersion(bin: string, args = ["-version"], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(`${stdout}${stderr}`.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "");
    });
  });
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
    return;
  }
  // on macOS and Linux a parent's death does not stop its children: signal the whole
  // tree, then force-kill whatever is still there after a grace period
  const pids = [...descendants(proc.pid), proc.pid];
  sendSignal(pids, "SIGTERM");
  setTimeout(() => sendSignal(pids.filter(isAlive), "SIGKILL"), 3000).unref();
}

/** Every process below `root`, read from `ps` (the same flags work on macOS and Linux). */
export function descendants(root: number): number[] {
  let table: string;
  try {
    table = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  } catch {
    return [];
  }
  const children = new Map<number, number[]>();
  for (const line of table.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || Number.isNaN(ppid)) continue;
    const list = children.get(ppid);
    if (list) list.push(pid);
    else children.set(ppid, [pid]);
  }
  const found: number[] = [];
  const stack = [root];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      found.push(child);
      stack.push(child);
    }
  }
  return found;
}

function sendSignal(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
