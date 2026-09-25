/**
 * Studio tools over Streamable HTTP on 127.0.0.1, for the desktop app: one
 * server for every open project, one Bearer token per project. The app passes
 * the URL and the token to the agent session (ACP `session/new.mcpServers`),
 * so an agent can only reach the project it was opened on.
 *
 * Stateless transport: each request gets a fresh MCP server bound to the
 * token's project, while the project's job runner persists across requests
 * (wait_job keeps working).
 */
import { randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../config.js";
import { JobRunner } from "./jobs.js";
import { Project } from "./project.js";
import { createStudioServer } from "./server.js";
import type { StudioContext } from "./tools.js";

export interface StudioHttp {
  /** e.g. http://127.0.0.1:53817/mcp */
  url: string;
  /** Opens a project; the token is the `Authorization: Bearer` credential for its tools. */
  addProject(dir: string, opts?: { config?: () => Config }): { token: string; jobs: JobRunner };
  /** Closes a project: cancels its jobs and revokes the token. */
  removeProject(token: string): void;
  close(): Promise<void>;
}

export async function startStudioHttp(opts: { port?: number; softLimitMs?: number } = {}): Promise<StudioHttp> {
  const host = "127.0.0.1";
  const projects = new Map<string, StudioContext>();

  const server = createServer(async (req, res) => {
    try {
      if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") return reply(res, 404, "Not found");
      const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
      const ctx = token ? projects.get(token) : undefined;
      if (!ctx) return reply(res, 401, "Missing or unknown Bearer token");

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = createStudioServer(ctx);
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      if (!res.headersSent) reply(res, 500, (e as Error).message);
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, host, () => ok());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${host}:${port}/mcp`,
    addProject(dir, o = {}) {
      const token = randomBytes(24).toString("base64url");
      const jobs = new JobRunner();
      projects.set(token, { project: new Project(dir), jobs, config: o.config, softLimitMs: opts.softLimitMs });
      return { token, jobs };
    },
    removeProject(token) {
      projects.get(token)?.jobs.cancelAll();
      projects.delete(token);
    },
    close() {
      for (const ctx of projects.values()) ctx.jobs.cancelAll();
      projects.clear();
      return new Promise((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      });
    },
  };
}

function reply(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
}
