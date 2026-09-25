/**
 * Claude Code, the first agent Get Frames drives. The app talks ACP to the
 * open-source adapter @agentclientprotocol/claude-agent-acp, run by Electron's
 * own Node, and the adapter runs the `claude` the user installed
 * (CLAUDE_CODE_EXECUTABLE), with the user's own login and settings.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentStatus } from "../../shared/types";
import { findOnPath, run, withPath } from "../locate";
import type { Launch } from "./acp";

export const CLAUDE_INSTALL_URL = "https://docs.claude.com/en/docs/claude-code/setup";
const LOGIN_COMMAND = "claude";

/** The `claude` to run: the one set in Settings, else the first on PATH, else npm's script on Windows. */
export function findClaude(pathValue: string, override = "", platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (override) return existsSync(override) ? override : undefined;
  const found = findOnPath("claude", pathValue, platform);
  if (found) return found;
  // `npm install -g` on Windows leaves a .cmd shim, which needs a shell; its script runs with node
  if (platform === "win32" && env.APPDATA) {
    const script = join(env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    if (existsSync(script)) return script;
  }
  return undefined;
}

/** A script (npm install on Windows) runs with node; the native build runs directly. */
function command(claude: string, args: string[]): [string, string[]] {
  return claude.endsWith(".js") ? ["node", [claude, ...args]] : [claude, args];
}

export async function detectClaude(pathValue: string, override = ""): Promise<AgentStatus> {
  const status: AgentStatus = {
    id: "claude-code",
    name: "Claude Code",
    installed: false,
    loggedIn: null,
    installUrl: CLAUDE_INSTALL_URL,
    loginCommand: LOGIN_COMMAND,
  };
  const claude = findClaude(pathValue, override);
  if (!claude) {
    if (override) status.error = `Không tìm thấy ${override}`;
    return status;
  }
  const env = withPath(process.env, pathValue);
  status.path = claude;
  try {
    const [file, args] = command(claude, ["--version"]);
    const res = await run(file, args, { env, timeoutMs: 20_000 });
    status.version = res.stdout.trim().split(/\r?\n/)[0]?.replace(/\s*\(Claude Code\)\s*$/, "");
    status.installed = res.code === 0;
    if (res.code !== 0) status.error = (res.stderr || res.stdout).trim().split(/\r?\n/)[0];
  } catch (e) {
    status.error = (e as Error).message;
    return status;
  }
  try {
    const [file, args] = command(claude, ["auth", "status", "--json"]);
    Object.assign(status, readAuthStatus((await run(file, args, { env, timeoutMs: 10_000 })).stdout));
  } catch {
    // an older claude without `auth status`: unknown, the first session will tell
  }
  return status;
}

/** Login state from `claude auth status --json` (it exits 1 when logged out, still printing JSON). */
export function readAuthStatus(stdout: string): Pick<AgentStatus, "loggedIn" | "account"> {
  let s: { loggedIn?: unknown; apiProvider?: string; apiKeySource?: string; subscriptionType?: string; email?: string; orgName?: string };
  try {
    s = JSON.parse(stdout);
  } catch {
    return { loggedIn: null };
  }
  if (!s || typeof s !== "object" || typeof s.loggedIn !== "boolean") return { loggedIn: null };
  // the CLI's own verdict counts every way in (claude.ai, an API key, Bedrock or Vertex); then how
  if (!s.loggedIn) return { loggedIn: false };
  if (s.apiProvider && s.apiProvider !== "firstParty") return { loggedIn: true, account: s.apiProvider };
  if (s.apiKeySource) return { loggedIn: true, account: `API key (${s.apiKeySource})` };
  const plan = s.subscriptionType ? `Claude ${s.subscriptionType.charAt(0).toUpperCase()}${s.subscriptionType.slice(1)}` : "Claude";
  return { loggedIn: true, account: [plan, s.email].filter(Boolean).join(" · ") };
}

/** Inside the packaged app, programs run by Node must come from app.asar.unpacked. */
export function unpacked(p: string): string {
  return p.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/** The adapter's entry script. */
export function adapterEntry(): string {
  const pkg = createRequire(import.meta.url).resolve("@agentclientprotocol/claude-agent-acp/package.json");
  return unpacked(join(dirname(pkg), "dist", "index.js"));
}

/** out/main/agent-launcher.js, built next to the main bundle. */
export function launcherScript(): string {
  return unpacked(join(dirname(fileURLToPath(import.meta.url)), "agent-launcher.js"));
}

export function claudeLaunch(opts: { claude: string; cwd: string; pathValue: string; logsDir?: string }): Launch {
  return {
    command: process.execPath,
    args: [launcherScript(), adapterEntry()],
    cwd: opts.cwd,
    env: {
      ...withPath(process.env, opts.pathValue),
      ELECTRON_RUN_AS_NODE: "1",
      CLAUDE_CODE_EXECUTABLE: opts.claude,
      ...(opts.logsDir ? { CLAUDE_AGENT_LOGS: opts.logsDir } : {}),
    },
    // never "bypass permissions", whatever the user's settings say: the app answers every request
    sessionMeta: { claudeCode: { options: { allowDangerouslySkipPermissions: false } } },
  };
}
