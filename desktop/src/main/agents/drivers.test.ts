import { describe, it, expect } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claudeLaunch } from "./claude-code";
import { codexLaunch, detectCodex, findCodex, readCodexLogin } from "./codex";
import { detectDevin, devinLaunch, findDevin, readDevinAuth } from "./devin";

const posix = process.platform !== "win32";
const options = { program: "/opt/homebrew/bin/agent", cwd: "/Users/dan/Get Frames/video", pathValue: "/opt/homebrew/bin:/usr/bin", logsDir: "/logs/agent" };

/** A stand-in for an agent's CLI: a shell script answering the app's checks. */
function fakeCli(name: string, lines: string[]): string {
  const dir = join(mkdtempSync(join(tmpdir(), `${name}-bin-`)), "bin");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${lines.join("\n")}\nexit 1\n`);
  chmodSync(file, 0o755);
  return dir;
}

describe("Claude Code driver", () => {
  it("starts the adapter with the user's claude, never in a mode that decides without the app", () => {
    const launch = claudeLaunch({ ...options, program: "/Users/dan/.local/bin/claude" });
    expect(launch.command).toBe(process.execPath);
    expect(launch.args[1]).toMatch(/claude-agent-acp[\\/]dist[\\/]index\.js$/);
    expect(launch.env).toMatchObject({ CLAUDE_CODE_EXECUTABLE: "/Users/dan/.local/bin/claude", CLAUDE_AGENT_LOGS: "/logs/agent", ELECTRON_RUN_AS_NODE: "1", PATH: options.pathValue });
    expect(launch.sessionMeta).toEqual({ claudeCode: { options: { allowDangerouslySkipPermissions: false } } });
    expect(launch.mode).toEqual({ start: "default", allowed: ["default", "plan"] });
  });
});

describe("Codex driver", () => {
  it("reads the login from `codex login status`, which answers on stderr", () => {
    expect(readCodexLogin({ code: 0, stdout: "", stderr: "Logged in using ChatGPT\n" })).toEqual({ loggedIn: true, account: "ChatGPT" });
    expect(readCodexLogin({ code: 0, stdout: "", stderr: "WARNING: proceeding…\nLogged in using an API key - sk-proj-***j1234\n" })).toEqual({ loggedIn: true, account: "API key" });
    expect(readCodexLogin({ code: 1, stdout: "", stderr: "Not logged in\n" })).toEqual({ loggedIn: false });
    expect(readCodexLogin({ code: 2, stdout: "", stderr: "error: unrecognized subcommand 'status'\n" })).toEqual({ loggedIn: null });
  });

  it("uses the path from Settings, else PATH, else npm's native build on Windows", () => {
    const appData = mkdtempSync(join(tmpdir(), "appdata-"));
    const openai = join(appData, "npm", "node_modules", "@openai");
    const nested = join(openai, "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    const hoisted = join(openai, "codex-win32-arm64", "vendor", "aarch64-pc-windows-msvc", "bin", "codex.exe");
    for (const exe of [nested, hoisted]) {
      mkdirSync(dirname(exe), { recursive: true });
      writeFileSync(exe, "MZ");
    }
    // npm's codex.cmd needs a shell; the codex.exe it starts does not
    expect(findCodex("", "", "win32", { APPDATA: appData }, "x64")).toBe(nested);
    expect(findCodex("", "", "win32", { APPDATA: appData }, "arm64")).toBe(hoisted);
    expect(findCodex("", "", "win32", { APPDATA: appData }, "ia32")).toBeUndefined();
    const bin = mkdtempSync(join(tmpdir(), "codex-path-"));
    writeFileSync(join(bin, "codex.exe"), "MZ");
    expect(findCodex(bin, "", "win32", { APPDATA: appData }, "x64")).toBe(join(bin, "codex.exe"));
    expect(findCodex(bin, join(bin, "missing"), "win32")).toBeUndefined();
  });

  it.skipIf(!posix)("runs the installed codex for its version and login", async () => {
    const dir = fakeCli("codex", [
      'if [ "$1" = "--version" ]; then echo "codex-cli 0.156.1"; exit 0; fi',
      'if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in using ChatGPT" >&2; exit 0; fi',
    ]);
    expect(await detectCodex(`${dir}:/usr/bin:/bin`)).toMatchObject({
      id: "codex",
      name: "Codex",
      installed: true,
      version: "0.156.1",
      loggedIn: true,
      account: "ChatGPT",
      path: join(dir, "codex"),
      loginCommand: "codex login",
    });
    expect(await detectCodex("/nonexistent")).toMatchObject({ installed: false, loggedIn: null, installUrl: expect.stringMatching(/^https:/) });
  });

  it("starts codex-acp with the user's codex, sandboxed, asking the app for anything more", () => {
    const launch = codexLaunch({ ...options, program: "/opt/homebrew/bin/codex" });
    expect(launch.command).toBe(process.execPath);
    expect(launch.args[1]).toMatch(/codex-acp[\\/]dist[\\/]index\.js$/);
    expect(launch.env).toMatchObject({
      CODEX_PATH: "/opt/homebrew/bin/codex",
      INITIAL_AGENT_MODE: "read-only",
      DISABLE_MCP_CONFIG_FILTERING: "true",
      NO_BROWSER: "1",
      APP_SERVER_LOGS: "/logs/agent",
      ELECTRON_RUN_AS_NODE: "1",
      PATH: options.pathValue,
    });
    expect(launch.mode).toEqual({ start: "read-only", allowed: ["read-only"] });
  });
});

describe("Devin driver", () => {
  it("reads the login from `devin auth status`, which exits 0 either way", () => {
    expect(readDevinAuth("Not logged in.\n  Credentials path: /Users/dan/.local/share/devin/credentials.toml\nRun `devin auth login` to authenticate.\n")).toEqual({ loggedIn: false });
    expect(readDevinAuth("Logged in (via browser)\n  File:              /Users/dan/.local/share/devin/credentials.toml\n")).toEqual({ loggedIn: true, account: "browser" });
    expect(readDevinAuth("Logged in\n")).toEqual({ loggedIn: true });
    expect(readDevinAuth("Failed to load credentials: permission denied\n")).toEqual({ loggedIn: null });
  });

  it("uses the path from Settings, else PATH", () => {
    const bin = mkdtempSync(join(tmpdir(), "devin-path-"));
    writeFileSync(join(bin, "devin.exe"), "MZ");
    expect(findDevin(bin, "", "win32")).toBe(join(bin, "devin.exe"));
    expect(findDevin(bin, join(bin, "missing"), "win32")).toBeUndefined();
  });

  it.skipIf(!posix)("runs the installed devin for its version and login", async () => {
    const dir = fakeCli("devin", [
      'if [ "$1" = "--version" ]; then echo "devin 3000.11.3 (9c803229faa4)"; exit 0; fi',
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then printf "Not logged in.\\n  Credentials path: x\\n"; exit 0; fi',
    ]);
    expect(await detectDevin(`${dir}:/usr/bin:/bin`)).toMatchObject({
      id: "devin",
      name: "Devin",
      installed: true,
      version: "3000.11.3",
      loggedIn: false,
      path: join(dir, "devin"),
      loginCommand: "devin auth login",
    });
  });

  it("starts `devin acp`, in its mode that edits the project and asks for the rest", () => {
    const launch = devinLaunch({ ...options, program: "/Users/dan/.local/bin/devin" });
    expect([launch.command, ...launch.args]).toEqual(["/Users/dan/.local/bin/devin", "acp"]);
    expect(launch.env).toMatchObject({ PATH: options.pathValue, RUST_LOG: process.env.RUST_LOG ?? "warn" });
    expect(launch.mode).toEqual({ start: "accept-edits", allowed: ["accept-edits", "ask", "plan"] });
  });
});
