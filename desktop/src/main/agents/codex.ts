/**
 * Codex. The app talks ACP to the open-source adapter
 * @agentclientprotocol/codex-acp, run by Electron's own Node, and the adapter
 * runs the `codex` the user installed (CODEX_PATH) as its app server, with the
 * user's own login (~/.codex) and settings. The Codex build the adapter
 * depends on is left out of the app (package.json overrides it with an empty
 * package): only the user's codex ever runs.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentStatus } from "../../shared/agents";
import type { AgentStatus } from "../../shared/types";
import { findOnPath, run, withPath } from "../locate";
import type { Launch } from "./acp";
import type { LaunchOptions } from "./drivers";
import { nodeAdapter } from "./node-adapter";

export const CODEX_ADAPTER = "@agentclientprotocol/codex-acp";

/** The native build inside `npm install -g @openai/codex`, by Windows architecture. */
const NPM_WINDOWS_BUILDS: Partial<Record<string, { pkg: string; triple: string }>> = {
  x64: { pkg: "codex-win32-x64", triple: "x86_64-pc-windows-msvc" },
  arm64: { pkg: "codex-win32-arm64", triple: "aarch64-pc-windows-msvc" },
};

/** The `codex` to run: the one set in Settings, else the first on PATH, else npm's native build on Windows. */
export function findCodex(
  pathValue: string,
  override = "",
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  arch: string = process.arch,
): string | undefined {
  if (override) return existsSync(override) ? override : undefined;
  const found = findOnPath("codex", pathValue, platform);
  if (found) return found;
  // npm leaves a .cmd shim on Windows, which needs a shell; the codex.exe it starts is in the package
  const build = NPM_WINDOWS_BUILDS[arch];
  if (platform === "win32" && env.APPDATA && build) {
    const openai = join(env.APPDATA, "npm", "node_modules", "@openai");
    for (const pkg of [join(openai, "codex", "node_modules", "@openai", build.pkg), join(openai, build.pkg)]) {
      const exe = join(pkg, "vendor", build.triple, "bin", "codex.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

export async function detectCodex(pathValue: string, override = ""): Promise<AgentStatus> {
  const status = agentStatus("codex");
  const codex = findCodex(pathValue, override);
  if (!codex) {
    if (override) status.error = `Không tìm thấy ${override}`;
    return status;
  }
  const env = withPath(process.env, pathValue);
  status.path = codex;
  try {
    const res = await run(codex, ["--version"], { env, timeoutMs: 20_000 });
    // "codex-cli 0.156.1"
    status.version = res.stdout.match(/codex-cli\s+(\S+)/)?.[1] ?? res.stdout.trim().split(/\r?\n/)[0];
    status.installed = res.code === 0;
    if (res.code !== 0) status.error = (res.stderr || res.stdout).trim().split(/\r?\n/)[0];
  } catch (e) {
    status.error = (e as Error).message;
    return status;
  }
  try {
    Object.assign(status, readCodexLogin(await run(codex, ["login", "status"], { env, timeoutMs: 10_000 })));
  } catch {
    // unknown: the first session will tell
  }
  return status;
}

/**
 * Login state from `codex login status`: it exits 0 when logged in and 1 when
 * not, and says how on stderr ("Logged in using ChatGPT", "Logged in using an
 * API key - sk-…", "Not logged in").
 */
export function readCodexLogin(res: { code: number; stdout: string; stderr: string }): Pick<AgentStatus, "loggedIn" | "account"> {
  const text = `${res.stdout}\n${res.stderr}`;
  if (res.code === 0) {
    if (/Logged in using ChatGPT/i.test(text)) return { loggedIn: true, account: "ChatGPT" };
    if (/Logged in using an API key/i.test(text)) return { loggedIn: true, account: "API key" };
    return { loggedIn: true };
  }
  return /Not logged in/i.test(text) ? { loggedIn: false } : { loggedIn: null };
}

export function codexLaunch(opts: LaunchOptions): Launch {
  return {
    ...nodeAdapter(CODEX_ADAPTER, {
      cwd: opts.cwd,
      pathValue: opts.pathValue,
      env: {
        CODEX_PATH: opts.program,
        // "Ask for approval": sandboxed to the project folder, no network; anything more asks the app
        INITIAL_AGENT_MODE: "read-only",
        // the Studio tools server the app passes wins over one of the same name in the user's config
        DISABLE_MCP_CONFIG_FILTERING: "true",
        // a login happens in the terminal (`codex login`), never in a browser the adapter opens
        NO_BROWSER: "1",
        APP_SERVER_LOGS: opts.logsDir,
      },
    }),
    // "Approve for me" and "Full access" would let Codex decide instead of the app
    mode: { start: "read-only", allowed: ["read-only"] },
  };
}
