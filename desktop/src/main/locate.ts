/**
 * Programs the app runs but does not ship: Claude Code (Codex and Devin
 * later) and FFmpeg. An app opened from Finder does not get the terminal's
 * PATH, so the login shell is asked for it once and the usual install folders
 * are searched too. Nothing is ever run through a shell.
 */
import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MARK = "__GET_FRAMES_PATH__";

/** PATH as the user's terminal has it (macOS, Linux); undefined on Windows or when the shell does not answer. */
export function loginShellPath(shell = process.env.SHELL, timeoutMs = 5000): Promise<string | undefined> {
  if (process.platform === "win32") return Promise.resolve(undefined);
  const sh = shell || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  return new Promise((resolve) => {
    // interactive login shell: reads .zprofile and .zshrc, where PATH is usually set up
    execFile(sh, ["-ilc", `printf '%s' "${MARK}$PATH${MARK}"`], { timeout: timeoutMs, encoding: "utf8" }, (_err, stdout) => {
      const parts = String(stdout ?? "").split(MARK);
      resolve(parts.length >= 3 && parts[1] ? parts[1] : undefined);
    });
  });
}

/** Where Claude Code, Homebrew, npm and FFmpeg installs usually put programs. */
export function wellKnownDirs(platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === "win32") {
    return [
      join(home, ".local", "bin"),
      env.APPDATA && join(env.APPDATA, "npm"),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"),
      join(home, "scoop", "shims"),
      env.ProgramData && join(env.ProgramData, "chocolatey", "bin"),
      "C:\\ffmpeg\\bin",
    ].filter((d): d is string => !!d);
  }
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
    "/usr/bin",
    "/bin",
  ];
}

const separator = (platform: NodeJS.Platform) => (platform === "win32" ? ";" : ":");

/** Joins PATH lists in order, without empty entries or duplicates. */
export function joinPath(lists: (string | string[] | undefined)[], platform: NodeJS.Platform = process.platform): string {
  const sep = separator(platform);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const dir of Array.isArray(list) ? list : (list ?? "").split(sep)) {
      const key = platform === "win32" ? dir.toLowerCase() : dir;
      if (!dir || seen.has(key)) continue;
      seen.add(key);
      out.push(dir);
    }
  }
  return out.join(sep);
}

/** First executable file called `name` in a PATH value; on Windows only `name.exe` (npm's .cmd shims need a shell). */
export function findOnPath(name: string, pathValue: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const file = platform === "win32" ? `${name}.exe` : name;
  for (const dir of pathValue.split(separator(platform))) {
    if (!dir) continue;
    const candidate = join(dir, file);
    if (isExecutable(candidate, platform)) return candidate;
  }
  return undefined;
}

export function isExecutable(p: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    if (platform !== "win32") accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** A copy of `env` with PATH set, whatever case its key had (Windows uses "Path"). */
export function withPath(env: NodeJS.ProcessEnv, pathValue: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() !== "PATH") out[k] = v;
  out.PATH = pathValue;
  return out;
}

/** Runs a program without a shell and returns its output, even when it exits with an error code. */
export function run(file: string, args: string[], opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number; cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeout = opts.timeoutMs ?? 15_000;
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: opts.env, cwd: opts.cwd, timeout, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: string | number | null; killed?: boolean }) | null;
      // could not start at all (ENOENT, EACCES…)
      if (e && typeof e.code === "string") return reject(e);
      if (e?.killed) return reject(new Error(`${file} did not answer within ${Math.round(timeout / 1000)} s`));
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
