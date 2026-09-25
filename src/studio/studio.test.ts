import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { findChrome } from "../lesson/storyboard.js";
import { startStudioHttp } from "./http.js";
import { JobRunner } from "./jobs.js";
import { Project } from "./project.js";
import { createStudioServer } from "./server.js";
import type { StudioContext } from "./tools.js";

const EXAMPLE = "examples/lessons/short-launch-vs-async/script.json";
const hasChrome = !!findChrome();
/** Windows without developer mode cannot create symbolic links. */
const canSymlink = (() => {
  try {
    const d = mkdtempSync(join(tmpdir(), "link-"));
    symlinkSync(d, join(d, "self"), "dir");
    return true;
  } catch {
    return false;
  }
})();

type EditableScript = { brand?: string; style?: string; chapters: { scenes: { id: string; voice: string }[] }[] };

/** A project folder holding the example Short, optionally edited. */
async function project(edit?: (script: EditableScript) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "studio-"));
  const script = JSON.parse(await readFile(EXAMPLE, "utf8"));
  edit?.(script);
  await writeFile(join(dir, "script.json"), JSON.stringify(script, null, 2));
  return dir;
}

async function connect(dir: string): Promise<Client> {
  return connectTo({ project: new Project(dir), jobs: new JobRunner() });
}

async function connectTo(ctx: StudioContext): Promise<Client> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createStudioServer(ctx).connect(serverSide);
  const client = new Client({ name: "studio-test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const first = res.content[0];
  return { isError: !!res.isError, body: JSON.parse(first.type === "text" ? first.text : "null") };
}

/** Keeps calling wait_job while a storyboard job runs, as an agent does; slow machines outlast one soft limit. */
async function settle(client: Client, res: Awaited<ReturnType<typeof call>>) {
  while (res.body.status === "queued" || res.body.status === "running") res = await call(client, "wait_job", { jobId: res.body.jobId });
  return res;
}

describe("Studio tools", () => {
  it("lists five tools with MCP annotations", async () => {
    const { tools } = await (await connect(await project())).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["build_storyboard", "check_layout", "list_catalog", "validate_script", "wait_job"]);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.validate_script).toMatchObject({ readOnlyHint: true });
    expect(byName.check_layout).toMatchObject({ destructiveHint: false, openWorldHint: false });
    expect(byName.build_storyboard).toMatchObject({ destructiveHint: false, openWorldHint: true });
  });

  describe("validate_script", () => {
    it("summarizes a valid script", async () => {
      const { isError, body } = await call(await connect(await project()), "validate_script");
      expect(isError).toBe(false);
      expect(body.ok).toBe(true);
      expect(body.summary).toMatchObject({ title: "Coroutine: launch hay async?", formats: ["portrait"], scenes: 5, style: "whiteboard" });
      expect(body.summary.estimatedSeconds).toBeGreaterThan(20);
    });

    it("reports schema errors with their path", async () => {
      const dir = await project((s) => (s.chapters[0].scenes[1].voice = ""));
      const { body } = await call(await connect(dir), "validate_script");
      expect(body.ok).toBe(false);
      expect(body.errors.map((e: { path: string }) => e.path)).toContain("chapters.0.scenes.1.voice");
    });

    it("reports an unknown style", async () => {
      const { body } = await call(await connect(await project((s) => (s.style = "neon-pink"))), "validate_script");
      expect(body.errors).toEqual([expect.objectContaining({ path: "style", message: expect.stringContaining("neon-pink") })]);
    });

    it("reports a brand whose default style does not exist", async () => {
      const brands = await mkdtemp(join(tmpdir(), "brands-"));
      await mkdir(join(brands, "acme"));
      await writeFile(join(brands, "acme", "brand.json"), JSON.stringify({ id: "acme", name: "Acme", defaultStyle: "neon-pink" }));
      const saved = process.env.BRANDS_DIR;
      process.env.BRANDS_DIR = brands;
      try {
        const dir = await project((s) => {
          s.brand = "acme";
          delete s.style;
        });
        const { body } = await call(await connect(dir), "validate_script");
        expect(body.errors).toEqual([
          expect.objectContaining({ path: "style", message: expect.stringContaining('"neon-pink" (the default of brand "acme")') }),
        ]);
      } finally {
        if (saved === undefined) delete process.env.BRANDS_DIR;
        else process.env.BRANDS_DIR = saved;
      }
    });

    it("reports missing files, broken JSON and paths outside the project", async () => {
      const dir = await project();
      await writeFile(join(dir, "broken.json"), "{ nope");
      const client = await connect(dir);
      expect((await call(client, "validate_script", { script: "other.json" })).body.errors[0].path).toBe("(file)");
      expect((await call(client, "validate_script", { script: "broken.json" })).body.errors[0].path).toBe("(json)");
      const outside = await call(client, "validate_script", { script: "../script.json" });
      expect(outside.body.errors[0].message).toMatch(/outside the project folder/);
    });
  });

  it("refuses to start a storyboard for an invalid script", async () => {
    const dir = await project((s) => (s.chapters[0].scenes[0].voice = ""));
    const { isError, body } = await call(await connect(dir), "check_layout");
    expect(isError).toBe(true);
    expect(body.status).toBe("invalid");
  });

  it("describes styles, brands, voices and sounds", async () => {
    const { body } = await call(await connect(await project()), "list_catalog");
    expect(body.styles.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(["dantech", "whiteboard"]));
    expect(body.brands).toEqual(expect.arrayContaining([{ id: "dan-tech", name: "Dan Tech" }]));
    expect(body.voices.free.available).toBe(true);
    expect(Array.isArray(body.sfx) && Array.isArray(body.music)).toBe(true);
  });

  it("says when a job id is unknown", async () => {
    const { isError, body } = await call(await connect(await project()), "wait_job", { jobId: "nope" });
    expect(isError).toBe(true);
    expect(body.status).toBe("unknown");
  });

  it.skipIf(!hasChrome)("check_layout builds the storyboard and reports coded warnings", async () => {
    const dir = await project((s) => {
      const parallel = s.chapters[0].scenes.find((sc) => sc.id === "parallel")!;
      parallel.voice = parallel.voice.replace("{wait}", "");
    });
    const client = await connect(dir);
    const { isError, body } = await settle(client, await call(client, "check_layout"));
    expect(isError).toBe(false);
    expect(body.status).toBe("done");
    const [portrait] = body.formats;
    expect(portrait).toMatchObject({ format: "portrait", storyboard: "portrait/storyboard.jpg", chapters: "portrait/chapters.txt" });
    expect(portrait.shots.length).toBeGreaterThanOrEqual(5);
    expect(existsSync(join(dir, portrait.storyboard))).toBe(true);
    expect(existsSync(join(dir, portrait.shots[0]))).toBe(true);
    expect(body.warnings).toEqual([expect.objectContaining({ code: "unknown-cue", scene: "parallel", format: "portrait" })]);
  }, 120_000);

  it.skipIf(!hasChrome)("answers \"running\" past the soft limit, then wait_job returns the result", async () => {
    const ctx: StudioContext = { project: new Project(await project()), jobs: new JobRunner(), softLimitMs: 1 };
    const client = await connectTo(ctx);
    const first = await call(client, "check_layout");
    expect(first.body).toMatchObject({ status: "running", kind: "check_layout" });
    expect(first.body.next).toContain(first.body.jobId);

    // with a real soft limit, each wait_job call blocks until the job ends or the limit passes
    ctx.softLimitMs = 30_000;
    const res = await settle(client, await call(client, "wait_job", { jobId: first.body.jobId }));
    expect(res.body.status).toBe("done");
    expect(res.body.formats[0].storyboard).toBe("portrait/storyboard.jpg");
  }, 120_000);
});

describe("Studio tools and symbolic links", () => {
  it.skipIf(!canSymlink)("refuses a script that links outside the project", async () => {
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    await writeFile(join(outside, "secret.json"), "{}");
    const dir = await project();
    symlinkSync(join(outside, "secret.json"), join(dir, "linked.json"));
    const { body } = await call(await connect(dir), "validate_script", { script: "linked.json" });
    expect(body.errors[0].message).toMatch(/outside the project folder through a symbolic link/);
  });

  it.skipIf(!canSymlink)("refuses to build into an output folder that is a link", async () => {
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    const dir = await project();
    symlinkSync(outside, join(dir, "portrait"), "dir");
    const { isError, body } = await call(await connect(dir), "check_layout");
    expect(isError).toBe(true);
    expect(body.errors[0].message).toMatch(/"portrait" leads outside the project folder through a symbolic link/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it.skipIf(!canSymlink)("refuses a link hidden inside an output folder", async () => {
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    await writeFile(join(outside, "victim.html"), "keep me");
    const dir = await project();
    await mkdir(join(dir, "portrait"));
    symlinkSync(join(outside, "victim.html"), join(dir, "portrait", "index.html"));
    const { isError, body } = await call(await connect(dir), "check_layout");
    expect(isError).toBe(true);
    expect(body.errors[0].message).toMatch(/^portrait\/index\.html is a symbolic link/);
    expect(await readFile(join(outside, "victim.html"), "utf8")).toBe("keep me");
  });
});

describe("Studio tools over stdio (the CLI)", () => {
  it("keeps stdout for MCP while the engine logs", async () => {
    const dir = await project();
    const client = new Client({ name: "studio-stdio-test", version: "1.0.0" });
    // the same entry an agent starts; tsx here, node dist/studio/cli.js once built
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/studio/cli.ts", "--project", dir], stderr: "pipe" }),
    );
    try {
      expect((await call(client, "validate_script")).body.ok).toBe(true);
      // a layout check logs a dozen lines; any of them on stdout would break the protocol
      if (hasChrome) expect((await settle(client, await call(client, "check_layout"))).body.status).toBe("done");
    } finally {
      await client.close();
    }
  }, 120_000);
});

describe("Studio tools over HTTP", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const c of cleanup) await c();
  });

  it("serves a project to the holder of its token only", async () => {
    const studio = await startStudioHttp();
    cleanup.push(() => studio.close());
    const { token } = studio.addProject(await project());
    expect(studio.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = new Client({ name: "studio-http-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(studio.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    cleanup.push(() => client.close());
    expect((await call(client, "validate_script")).body.ok).toBe(true);

    const stranger = new Client({ name: "stranger", version: "1.0.0" });
    await expect(
      stranger.connect(new StreamableHTTPClientTransport(new URL(studio.url), { requestInit: { headers: { Authorization: "Bearer wrong" } } })),
    ).rejects.toThrow();

    studio.removeProject(token);
    await expect(call(client, "validate_script")).rejects.toThrow();
  });

  it("turns away web pages and foreign Host headers, even with a valid token", async () => {
    const studio = await startStudioHttp();
    cleanup.push(() => studio.close());
    const { token } = studio.addProject(await project());
    const { port } = new URL(studio.url);
    const status = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          { host: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end("{}");
      });
    expect(await status({ Host: "attacker.example" })).toBe(403);
    expect(await status({ Origin: "https://attacker.example" })).toBe(403);
  });
});
