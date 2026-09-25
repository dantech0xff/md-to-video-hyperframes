import { describe, it, expect } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClaude, findClaude, readAuthStatus } from "./agents/claude-code";
import { findOnPath, joinPath, run, wellKnownDirs, withPath } from "./locate";

const posix = process.platform !== "win32";

function bin(dir: string, name: string, script: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe("PATH helpers", () => {
  it("joins PATH lists in order without duplicates", () => {
    expect(joinPath(["/opt/homebrew/bin:/usr/bin", undefined, ["/usr/bin", "/usr/local/bin"], ""], "darwin")).toBe("/opt/homebrew/bin:/usr/bin:/usr/local/bin");
    expect(joinPath(["C:\\Windows;C:\\Tools", ["c:\\windows", "C:\\ffmpeg\\bin"]], "win32")).toBe("C:\\Windows;C:\\Tools;C:\\ffmpeg\\bin");
  });

  it("knows where installers put programs", () => {
    expect(wellKnownDirs("darwin", "/Users/dan")).toEqual(expect.arrayContaining(["/opt/homebrew/bin", "/Users/dan/.local/bin", "/Users/dan/.claude/local"]));
    expect(wellKnownDirs("win32", "C:\\Users\\dan", { APPDATA: "C:\\Users\\dan\\AppData\\Roaming" })).toEqual(
      expect.arrayContaining(["C:\\Users\\dan\\.local\\bin", "C:\\Users\\dan\\AppData\\Roaming\\npm"]),
    );
  });

  it("sets PATH whatever case its key had", () => {
    expect(withPath({ Path: "C:\\Windows", HOME: "x" }, "C:\\Tools")).toEqual({ PATH: "C:\\Tools", HOME: "x" });
  });

  it.skipIf(!posix)("finds executables on PATH, skipping files that are not", () => {
    const root = mkdtempSync(join(tmpdir(), "locate-"));
    writeFileSync(join(root, "ffmpeg"), "not executable");
    const real = bin(join(root, "bin"), "ffmpeg", "echo ffmpeg");
    expect(findOnPath("ffmpeg", `${root}:${join(root, "bin")}`)).toBe(real);
    expect(findOnPath("ffprobe", `${root}:${join(root, "bin")}`)).toBeUndefined();
  });

  it("only takes .exe files on Windows", () => {
    const root = mkdtempSync(join(tmpdir(), "locate-win-"));
    writeFileSync(join(root, "claude.cmd"), "@echo off");
    expect(findOnPath("claude", root, "win32")).toBeUndefined();
    writeFileSync(join(root, "claude.exe"), "MZ");
    expect(findOnPath("claude", root, "win32")).toBe(join(root, "claude.exe"));
  });

  it("returns the exit code and output, and rejects when a program cannot start", async () => {
    const res = await run(process.execPath, ["-e", "process.stdout.write('hi'); process.exit(3)"]);
    expect(res).toMatchObject({ code: 3, stdout: "hi" });
    await expect(run(join(tmpdir(), "no-such-program-xyz"), [])).rejects.toThrow();
  });
});

describe("Claude Code detection", () => {
  it("reads the login state from claude auth status --json", () => {
    expect(readAuthStatus('{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max", "email": "dan@dantech.academy"}')).toEqual({
      loggedIn: true,
      account: "Claude Max · dan@dantech.academy",
    });
    expect(readAuthStatus('{"loggedIn": false}')).toEqual({ loggedIn: false });
    // what `claude auth status --json` (2.1.282) prints for an API key and for Bedrock
    expect(readAuthStatus('{"loggedIn": true, "authMethod": "oauth_token", "apiProvider": "firstParty", "apiKeySource": "ANTHROPIC_API_KEY"}')).toEqual({
      loggedIn: true,
      account: "API key (ANTHROPIC_API_KEY)",
    });
    expect(readAuthStatus('{"loggedIn": true, "authMethod": "third_party", "apiProvider": "bedrock"}')).toEqual({ loggedIn: true, account: "bedrock" });
    // the CLI says no: a configured key or provider does not make it yes
    expect(readAuthStatus('{"loggedIn": false, "apiKeySource": "ANTHROPIC_API_KEY"}')).toEqual({ loggedIn: false });
    expect(readAuthStatus('{"loggedIn": false, "apiProvider": "bedrock"}')).toEqual({ loggedIn: false });
    expect(readAuthStatus("error: unknown command 'auth'")).toEqual({ loggedIn: null });
  });

  it("uses the path from Settings, else PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-"));
    expect(findClaude("", join(root, "missing"))).toBeUndefined();
    writeFileSync(join(root, "claude.exe"), "MZ");
    expect(findClaude(root, "", "win32", {})).toBe(join(root, "claude.exe"));
  });

  it.skipIf(!posix)("runs the installed claude for its version and login", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "claude-bin-")), "bin");
    bin(
      dir,
      "claude",
      [
        'if [ "$1" = "--version" ]; then echo "2.1.30 (Claude Code)"; exit 0; fi',
        'if [ "$1" = "auth" ]; then echo \'{"loggedIn": true, "subscriptionType": "pro", "email": "dan@dantech.academy"}\'; exit 0; fi',
        "exit 1",
      ].join("\n"),
    );
    const status = await detectClaude(`${dir}:/usr/bin:/bin`);
    expect(status).toMatchObject({ installed: true, version: "2.1.30", loggedIn: true, account: "Claude Pro · dan@dantech.academy", path: join(dir, "claude") });

    const missing = await detectClaude("/nonexistent");
    expect(missing).toMatchObject({ installed: false, loggedIn: null, installUrl: expect.stringMatching(/^https:/) });
  });
});
