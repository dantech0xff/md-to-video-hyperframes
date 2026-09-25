/**
 * Which agent requests the app answers by itself (design doc, "Quyền của
 * agent"): reading, creating and editing files inside the project folder and
 * calling the Studio tools are allowed; shell commands, anything outside the
 * project folder, network access, the files that configure the agent,
 * sub-agents and everything else go to the user.
 */
import { lstatSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isInside, realRelative } from "../fs-guard";
import type { PermissionOption } from "../../shared/types";
import type { PermissionRequest } from "./acp";

/** Name of the Studio tools server in every session's mcpServers; not one the user's own servers are likely to have. */
export const STUDIO_SERVER = "getframes";
/** The Studio tools (src/studio/tools.ts): only these are allowed without asking. */
export const STUDIO_TOOLS = ["validate_script", "check_layout", "build_storyboard", "wait_job", "list_catalog"] as const;
/** Where Claude Code says the servers the app passed in session/new come from (--mcp-config). */
const APP_SERVER_SOURCE = "dynamic";
/**
 * Names at the top of the project folder the agent may not change without
 * asking: its settings can hold hooks, permission rules and MCP servers (all
 * of which run commands), and the app keeps its own files there.
 */
const PROTECTED = new Set([".claude", ".mcp.json", ".agents", ".git", ".getframes", "project.json", "agents.md", "claude.md"]);
/**
 * Agent configuration in a project folder that works before, or instead of,
 * a permission request: hooks and helper commands, MCP servers, permission
 * rules and modes. The app writes none of it, and an agent only with the
 * user's say (PROTECTED); Claude Code reads it when the session starts.
 */
const AGENT_CONFIG = [".claude/settings.json", ".claude/settings.local.json", ".mcp.json"];
/** Claude Code tools of the "think" kind that only keep the agent's to-do list. */
const BOOKKEEPING = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]);

export type Decision = { allow: true; optionId: string; reason: string } | { allow: false };

export function decide(req: PermissionRequest, projectDir: string): Decision {
  const allow = allowOnce(req);
  if (!allow) return { allow: false };
  if (isStudioTool(req)) return { allow: true, optionId: allow, reason: "Studio tools" };
  if (req.tool === "Skill") return { allow: true, optionId: allow, reason: "skill in the project" };

  const paths = [...req.paths, ...inputPaths(req.rawInput)];
  const inside = paths.every((p) => isInside(projectDir, p));
  switch (req.kind) {
    // with no path, reading and searching start from the working directory: the project
    case "read":
    case "search":
      return inside ? { allow: true, optionId: allow, reason: "inside the project" } : { allow: false };
    case "edit":
    case "delete":
    case "move":
      return paths.length > 0 && inside && !paths.some((p) => isProtected(projectDir, p)) ? { allow: true, optionId: allow, reason: "inside the project" } : { allow: false };
    // the agent's own to-do list; a sub-agent (Agent, Task) is the user's call: the app cannot see what it will be asked to do
    case "think":
      return req.tool !== undefined && BOOKKEEPING.has(req.tool) ? { allow: true, optionId: allow, reason: "to-do list" } : { allow: false };
    default:
      return { allow: false };
  }
}

/**
 * One of the Studio tools of the server the app passed. The tool name alone
 * is what any server of that name would have, so it takes Claude Code saying
 * where the server was configured; versions too old to say ask the user.
 */
export function isStudioTool(req: PermissionRequest): boolean {
  if (!STUDIO_TOOLS.some((t) => req.tool === `mcp__${STUDIO_SERVER}__${t}`)) return false;
  return req.mcpServer?.name === STUDIO_SERVER && req.mcpServer.source === APP_SERVER_SOURCE;
}

/** The agent configuration files in the project (a link counts): a session does not start while there are any. */
export function agentConfigFiles(projectDir: string): string[] {
  return AGENT_CONFIG.filter((rel) => lstatSync(join(projectDir, rel), { throwIfNoEntry: false }));
}

/**
 * The answers the user is offered: this request only. "Always" answers would
 * write a rule into the project's .claude/settings.local.json, or switch the
 * agent to a mode that stops asking, and the app decides every request.
 */
export function oneTimeOptions(options: PermissionOption[]): PermissionOption[] {
  return options.filter((o) => o.kind === "allow_once" || o.kind === "reject_once");
}

/** The path is (or is inside) one of the PROTECTED names, as written or after resolving symbolic links. */
function isProtected(projectDir: string, p: string): boolean {
  const written = relative(resolve(projectDir), resolve(projectDir, p));
  return [written, realRelative(projectDir, p)].some((rel) => rel !== undefined && PROTECTED.has(rel.split(/[\\/]/)[0].toLowerCase()));
}

/** "Allow once" rather than "always": the app decides every time, and writes no rule into the agent's settings. */
function allowOnce(req: PermissionRequest): string | undefined {
  return (req.options.find((o) => o.kind === "allow_once") ?? req.options.find((o) => o.kind === "allow_always"))?.id;
}

/** Paths in a tool's input that ACP locations may leave out (Grep's `path`). */
function inputPaths(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const input = raw as Record<string, unknown>;
  return ["file_path", "path", "notebook_path"].map((k) => input[k]).filter((v): v is string => typeof v === "string" && v.length > 0);
}
