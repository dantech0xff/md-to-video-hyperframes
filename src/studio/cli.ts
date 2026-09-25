#!/usr/bin/env node
/**
 * Studio tools as an MCP server, for agents running in a terminal:
 *
 *   node dist/studio/cli.js [--project <dir>]                      stdio: the agent starts it (project: current folder)
 *   node dist/studio/cli.js --http [--port 4777] [--project <dir>]  HTTP on 127.0.0.1: prints the URL and a Bearer token
 *
 * `npm run studio -- …` runs the same from the sources. Keys and voices come
 * from this repo's .env.local. Logs go to stderr.
 */
import "./quiet-stdout.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startStudioHttp } from "./http.js";
import { JobRunner } from "./jobs.js";
import { Project } from "./project.js";
import { createStudioServer } from "./server.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
config({ path: join(ROOT, ".env.local"), quiet: true });

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const project = new Project(arg("--project") ?? process.cwd());

if (process.argv.includes("--http")) {
  const studio = await startStudioHttp({ port: Number(arg("--port") ?? 0) });
  const { token } = studio.addProject(project.dir);
  console.error(
    [
      `Studio tools for ${project.dir}`,
      `  URL:   ${studio.url}`,
      `  Token: ${token}`,
      "",
      "Claude Code:",
      `  claude mcp add --transport http getframes-studio ${studio.url} --header "Authorization: Bearer ${token}"`,
      "",
      "Ctrl+C to stop.",
    ].join("\n"),
  );
  const stop = () => void studio.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else {
  const jobs = new JobRunner();
  const server = createStudioServer({ project, jobs });
  await server.connect(new StdioServerTransport());
  const stop = () => {
    jobs.cancelAll();
    void server.close().then(() => process.exit(0));
  };
  process.stdin.on("close", stop);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
