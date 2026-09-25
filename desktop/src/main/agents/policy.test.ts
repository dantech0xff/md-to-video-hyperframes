import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionRequest } from "./acp";
import { decide } from "./policy";

const OPTIONS = [
  { id: "once", name: "Allow", kind: "allow_once" as const },
  { id: "always", name: "Always", kind: "allow_always" as const },
  { id: "no", name: "Reject", kind: "reject_once" as const },
];

const project = mkdtempSync(join(tmpdir(), "policy-"));
mkdirSync(join(project, "sources"));
const outside = mkdtempSync(join(tmpdir(), "elsewhere-"));

const req = (r: Partial<PermissionRequest>): PermissionRequest => ({ toolCallId: "t", title: "tool", paths: [], options: OPTIONS, ...r });
const allowed = (r: Partial<PermissionRequest>) => decide(req(r), project).allow;

describe("permission policy", () => {
  it("allows reading and searching inside the project, and asks outside it", () => {
    expect(allowed({ kind: "read", paths: [join(project, "sources", "a.md")] })).toBe(true);
    expect(allowed({ kind: "read", paths: ["sources/a.md"] })).toBe(true);
    expect(allowed({ kind: "search" })).toBe(true);
    expect(allowed({ kind: "read", paths: [join(outside, "secret.txt")] })).toBe(false);
    expect(allowed({ kind: "read", paths: ["../other/notes.md"] })).toBe(false);
    // Grep names its folder only in the tool input
    expect(allowed({ kind: "search", rawInput: { pattern: "key", path: outside } })).toBe(false);
  });

  it("allows edits inside the project only, and never edits without a path", () => {
    expect(allowed({ kind: "edit", paths: [join(project, "script.json")] })).toBe(true);
    expect(allowed({ kind: "edit", paths: [join(project, "short", "script.json")] })).toBe(true);
    expect(allowed({ kind: "edit", rawInput: { file_path: join(outside, ".zshrc") } })).toBe(false);
    expect(allowed({ kind: "edit" })).toBe(false);
    expect(allowed({ kind: "delete", paths: [join(project, "voice")] })).toBe(true);
  });

  it.skipIf(process.platform === "win32")("sees through symbolic links that lead out of the project", () => {
    symlinkSync(outside, join(project, "escape"));
    expect(allowed({ kind: "edit", paths: [join(project, "escape", "x.txt")] })).toBe(false);
    expect(allowed({ kind: "read", paths: [join(project, "escape")] })).toBe(false);
  });

  it("allows the Studio tools and the project's skill, not other MCP servers", () => {
    expect(allowed({ kind: "other", tool: "mcp__studio__build_storyboard", title: "mcp__studio__build_storyboard" })).toBe(true);
    expect(allowed({ kind: "other", mcpServer: "studio", title: "build_storyboard" })).toBe(true);
    expect(allowed({ kind: "other", mcpServer: "github", tool: "mcp__studio__x", title: "x" })).toBe(false);
    expect(allowed({ kind: "other", tool: "mcp__github__create_issue", title: "mcp__github__create_issue" })).toBe(false);
    expect(allowed({ kind: "other", tool: "Skill", title: "Load skill: create-lesson-video" })).toBe(true);
  });

  it("asks for shell commands, network access and anything unknown", () => {
    expect(allowed({ kind: "execute", title: "npm run lesson", rawInput: { command: "npm run lesson" } })).toBe(false);
    expect(allowed({ kind: "fetch", title: "Fetch https://example.com" })).toBe(false);
    expect(allowed({ kind: "switch_mode", title: "Ready to code?" })).toBe(false);
    expect(allowed({ title: "something new" })).toBe(false);
  });

  it("picks allow once, and never decides when there is nothing to allow", () => {
    expect(decide(req({ kind: "edit", paths: [join(project, "a.json")] }), project)).toMatchObject({ allow: true, optionId: "once" });
    const onlyAlways = [OPTIONS[1], OPTIONS[2]];
    expect(decide(req({ kind: "edit", paths: [join(project, "a.json")], options: onlyAlways }), project)).toMatchObject({ allow: true, optionId: "always" });
    expect(decide(req({ kind: "edit", paths: [join(project, "a.json")], options: [OPTIONS[2]] }), project).allow).toBe(false);
  });
});
