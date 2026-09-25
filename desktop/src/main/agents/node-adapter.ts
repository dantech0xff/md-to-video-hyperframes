/**
 * ACP adapters that are Node programs shipped inside the app (Claude Code's
 * and Codex's): Electron's own Node runs them, through agent-launcher.js, and
 * they run the agent the user installed.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withPath } from "../locate";
import type { Launch } from "./acp";

/** Inside the packaged app, programs run by Node must come from app.asar.unpacked. */
export function unpacked(p: string): string {
  return p.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/** An adapter package's entry script. */
export function adapterEntry(pkg: string): string {
  const json = createRequire(import.meta.url).resolve(`${pkg}/package.json`);
  return unpacked(join(dirname(json), "dist", "index.js"));
}

/** out/main/agent-launcher.js, built next to the main bundle. */
export function launcherScript(): string {
  return unpacked(join(dirname(fileURLToPath(import.meta.url)), "agent-launcher.js"));
}

/** Starts the adapter package `pkg` with Electron as Node, the user's PATH and `env` added. */
export function nodeAdapter(pkg: string, opts: { cwd: string; pathValue: string; env: NodeJS.ProcessEnv }): Pick<Launch, "command" | "args" | "cwd" | "env"> {
  return {
    command: process.execPath,
    args: [launcherScript(), adapterEntry(pkg)],
    cwd: opts.cwd,
    env: { ...withPath(process.env, opts.pathValue), ELECTRON_RUN_AS_NODE: "1", ...opts.env },
  };
}
