import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { progressReader, renderWithHyperframes } from "./hyperframes-runner.js";

describe("progressReader", () => {
  it("parses the redrawn progress line, ANSI colours and all", () => {
    const seen: [number, string][] = [];
    const read = progressReader((p, s) => seen.push([p, s]));
    read("\r\x1B[2K  \x1B[36m██\x1B[39m\x1B[2m░░░\x1B[22m  \x1B[1m4");
    read("0%\x1B[22m  \x1B[2mCapturing frames\x1B[22m");
    read("\r\x1B[2K  ███░░  60%  Capturing frames\r\x1B[2K  █████  100%  Encoding\n");
    expect(seen).toEqual([
      [40, "Capturing frames"],
      [60, "Capturing frames"],
      [100, "Encoding"],
    ]);
  });

  it("skips repeated updates and lines without a percentage", () => {
    const seen: number[] = [];
    const read = progressReader((p) => seen.push(p));
    read("Rendering lesson…\n  ██  10%  Capturing\r  ██  10%  Capturing\r  ███  20%  Capturing\n");
    expect(seen).toEqual([10, 20]);
  });

  it("does nothing without a callback", () => {
    expect(() => progressReader()("  █  50%  x\n")).not.toThrow();
  });
});

describe("renderWithHyperframes (fake CLI)", () => {
  let dir: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "hf-runner-"));
    // stands in for the HyperFrames CLI: echoes the env it got, reports progress, then exits or hangs
    await writeFile(
      join(dir, "cli.mjs"),
      [
        "const [, , cmd, , , out] = process.argv;",
        "if (process.env.HYPERFRAMES_NO_TELEMETRY !== '1' || process.env.HYPERFRAMES_NO_AUTO_INSTALL !== '1') process.exit(3);",
        "const { writeFileSync } = await import('node:fs');",
        "const { dirname, join } = await import('node:path');",
        // like the encoder, the output file is there from the first frames on
        "writeFileSync(out, 'new video');",
        "process.stdout.write('\\r  ██  50%  Capturing frames');",
        "process.stdout.write('\\r  ████  100%  Encoding\\n');",
        "if (out.endsWith('hang.mp4')) setInterval(() => {}, 1000);",
        // like Chrome workers or an encoder: a child that outlives its parent unless killed too
        "else if (out.endsWith('tree.mp4')) {",
        "  const { spawn } = await import('node:child_process');",
        "  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        "  writeFileSync(join(dirname(out), 'tree.pid'), String(child.pid));",
        "  setInterval(() => {}, 1000);",
        "}",
        "else if (out.endsWith('fail.mp4')) process.exit(2);",
        "else if (cmd !== 'render') process.exit(4);",
      ].join("\n"),
    );
    process.env.HYPERFRAMES_CLI = join(dir, "cli.mjs");
  });

  afterEach(() => {
    process.env = { ...saved, HYPERFRAMES_CLI: join(dir, "cli.mjs") };
  });

  it("runs the CLI with this Node, reports progress and puts the video in place", async () => {
    const seen: number[] = [];
    await renderWithHyperframes({ compositionDir: dir, outputPath: join(dir, "ok.mp4"), onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([50, 100]);
    expect(await readFile(join(dir, "ok.mp4"), "utf8")).toBe("new video");
    expect(existsSync(join(dir, ".rendering-ok.mp4"))).toBe(false);
  });

  it("rejects with the exit code when the render fails, keeping the last good video", async () => {
    await writeFile(join(dir, "fail.mp4"), "last good video");
    await expect(renderWithHyperframes({ compositionDir: dir, outputPath: join(dir, "fail.mp4") })).rejects.toThrow(/exit code 2/);
    expect(await readFile(join(dir, "fail.mp4"), "utf8")).toBe("last good video");
    expect(existsSync(join(dir, ".rendering-fail.mp4"))).toBe(false);
  });

  it("stops the render when aborted", async () => {
    const ac = new AbortController();
    const started = Date.now();
    const run = renderWithHyperframes({
      compositionDir: dir,
      outputPath: join(dir, "hang.mp4"),
      signal: ac.signal,
      onProgress: (p) => p === 100 && ac.abort(new Error("cancelled by user")),
    });
    await expect(run).rejects.toThrow("cancelled by user");
    expect(Date.now() - started).toBeLessThan(5000);
    // no half-written video is left behind
    expect(existsSync(join(dir, "hang.mp4"))).toBe(false);
    expect(existsSync(join(dir, ".rendering-hang.mp4"))).toBe(false);
  });

  it("stops the processes the CLI started as well", async () => {
    const out = join(dir, "tree.mp4");
    const ac = new AbortController();
    const run = renderWithHyperframes({ compositionDir: dir, outputPath: out, signal: ac.signal });
    let pid = 0;
    for (let i = 0; i < 100 && !pid; i++) {
      await new Promise((r) => setTimeout(r, 50));
      pid = Number(await readFile(join(dir, "tree.pid"), "utf8").catch(() => "0"));
    }
    expect(pid).toBeGreaterThan(0);
    ac.abort(new Error("cancelled"));
    await expect(run).rejects.toThrow("cancelled");

    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }, 20_000);

  it("refuses to start when already aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("too late"));
    await expect(renderWithHyperframes({ compositionDir: dir, outputPath: join(dir, "ok.mp4"), signal: ac.signal })).rejects.toThrow("too late");
  });
});
