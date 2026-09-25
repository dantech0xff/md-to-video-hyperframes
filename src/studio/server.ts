/** The Studio tools as an MCP server, over any transport (stdio for terminals, HTTP for the desktop app). */
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStudioTools, type StudioContext } from "./tools.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

const INSTRUCTIONS = [
  "Studio tools for Get Frames lesson videos. Work on script.json in the project folder, then:",
  "validate_script after every edit → check_layout (no narration, seconds) → build_storyboard (real narration).",
  "Open the storyboard and shot images they return to review the frames; fix every coded warning.",
  "Paths are relative to the project folder. Never render: the app renders after the user approves the storyboard.",
].join("\n");

export function createStudioServer(ctx: StudioContext): McpServer {
  const server = new McpServer({ name: "get-frames-studio", version }, { instructions: INSTRUCTIONS });
  registerStudioTools(server, ctx);
  return server;
}
