/**
 * Which agent requests the app answers by itself (design doc, "Quyền của
 * agent"): reading, creating and editing files inside the project folder and
 * calling the Studio tools are allowed; shell commands, anything outside the
 * project folder, network access and everything else go to the user.
 */
import { isInside } from "../fs-guard";
import type { PermissionRequest } from "./acp";

/** Name of the Studio tools server in every session's mcpServers. */
export const STUDIO_SERVER = "studio";

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
      return paths.length > 0 && inside ? { allow: true, optionId: allow, reason: "inside the project" } : { allow: false };
    // sub-agents; their own tool calls come through here too
    case "think":
      return { allow: true, optionId: allow, reason: "sub-task" };
    default:
      return { allow: false };
  }
}

export function isStudioTool(req: PermissionRequest): boolean {
  if (req.mcpServer !== undefined) return req.mcpServer === STUDIO_SERVER;
  return (req.tool ?? req.title).startsWith(`mcp__${STUDIO_SERVER}__`);
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
