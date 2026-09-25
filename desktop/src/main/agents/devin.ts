/**
 * Devin (the Devin CLI from Cognition). It speaks ACP itself: `devin acp`,
 * with the user's own login and settings.
 */
import { existsSync } from "node:fs";
import { agentStatus } from "../../shared/agents";
import type { AgentStatus } from "../../shared/types";
import { findOnPath, run, withPath } from "../locate";
import type { Launch } from "./acp";
import type { LaunchOptions } from "./drivers";

/** The `devin` to run: the one set in Settings, else the first on PATH (the installer puts it in ~/.local/bin). */
export function findDevin(pathValue: string, override = "", platform: NodeJS.Platform = process.platform): string | undefined {
  if (override) return existsSync(override) ? override : undefined;
  return findOnPath("devin", pathValue, platform);
}

export async function detectDevin(pathValue: string, override = ""): Promise<AgentStatus> {
  const status = agentStatus("devin");
  const devin = findDevin(pathValue, override);
  if (!devin) {
    if (override) status.error = `Không tìm thấy ${override}`;
    return status;
  }
  const env = withPath(process.env, pathValue);
  status.path = devin;
  try {
    const res = await run(devin, ["--version"], { env, timeoutMs: 20_000 });
    // "devin 3000.11.3 (9c803229faa4)"
    status.version = res.stdout.match(/devin\s+(\S+)/)?.[1] ?? res.stdout.trim().split(/\r?\n/)[0];
    status.installed = res.code === 0;
    if (res.code !== 0) status.error = (res.stderr || res.stdout).trim().split(/\r?\n/)[0];
  } catch (e) {
    status.error = (e as Error).message;
    return status;
  }
  try {
    Object.assign(status, readDevinAuth((await run(devin, ["auth", "status"], { env, timeoutMs: 10_000 })).stdout));
  } catch {
    // unknown: the first session will tell
  }
  return status;
}

/** Login state from `devin auth status`, which exits 0 either way: "Not logged in." or "Logged in (via …)". */
export function readDevinAuth(stdout: string): Pick<AgentStatus, "loggedIn" | "account"> {
  const first = stdout.trim().split(/\r?\n/)[0] ?? "";
  if (/^Not logged in/i.test(first)) return { loggedIn: false };
  const logged = first.match(/^Logged in(?:\s*\(via ([^)]+)\))?/i);
  if (!logged) return { loggedIn: null };
  return logged[1] ? { loggedIn: true, account: logged[1].trim() } : { loggedIn: true };
}

export function devinLaunch(opts: LaunchOptions): Launch {
  return {
    command: opts.program,
    args: ["acp"],
    cwd: opts.cwd,
    // warnings and errors only in the app's agent.log (a session start logs dozens of lines); Devin's own log file keeps the rest
    env: { ...withPath(process.env, opts.pathValue), RUST_LOG: process.env.RUST_LOG ?? "warn" },
    // "Code" allows edits in the project folder and asks for the rest; Ask and Plan only read.
    // "Smart" and "Bypass Permissions" would let Devin decide instead of the app
    mode: { start: "accept-edits", allowed: ["accept-edits", "ask", "plan"] },
  };
}
