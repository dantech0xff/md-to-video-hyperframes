/**
 * Storyboard — capture the "hero frame" of every scene straight from the
 * composition (no full render) and tile them into storyboard.jpg, so a lesson
 * can be reviewed in seconds instead of minutes.
 */
import { createServer, type Server } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, extname, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";
import { ffmpegBin } from "../utils/binaries.js";

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".gif": "image/gif",
};

function serve(dir: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = resolve(dir, "." + (url === "/" ? "/index.html" : url));
    const rel = relative(dir, file);
    if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok, fail) => {
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      ok({ server, port: typeof a === "object" && a ? a.port : 0 });
    });
  });
}

/** Chrome for puppeteer: env override → HyperFrames' managed browser → system. */
export function findChrome(): string | undefined {
  for (const k of ["CHROME_PATH", "PUPPETEER_EXECUTABLE_PATH", "HYPERFRAMES_BROWSER_PATH", "PRODUCER_HEADLESS_SHELL_PATH"]) {
    const v = process.env[k];
    if (v && existsSync(v)) return v;
  }
  const roots = [join(homedir(), ".cache", "hyperframes"), join(homedir(), ".cache", "puppeteer"), "/opt/pw-browsers"];
  const exe = process.platform === "win32" ? ".exe" : "";
  const names = new Set(["chrome-headless-shell", "headless_shell", "chrome"].map((n) => n + exe));
  const walk = (d: string, depth: number): string | undefined => {
    if (depth > 6 || !existsSync(d)) return undefined;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isFile() && names.has(e)) return p;
      if (st.isDirectory()) {
        const hit = walk(p, depth + 1);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  for (const r of roots) {
    const hit = walk(r, 0);
    if (hit) return hit;
  }
  const system =
    process.platform === "win32"
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
          .filter((d): d is string => !!d)
          .map((d) => join(d, "Google", "Chrome", "Application", "chrome.exe"))
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  for (const p of system) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Same WebGL setup as HyperFrames (SwiftShader), so 3D scenes render in the storyboard too. */
const CHROME_ARGS = ["--no-sandbox", "--hide-scrollbars", "--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

export interface Shot {
  t: number;
  label: string;
}

export interface CaptureOptions {
  /** aborting stops before the next shot or frame */
  signal?: AbortSignal;
  /** 3D scenes came out blank (no WebGL in this Chrome); logged as a warning when omitted */
  onWebglUnavailable?: (message: string) => void;
}

export async function captureStoryboard(dir: string, shots: Shot[], size: { w: number; h: number }, out: string, opts: CaptureOptions = {}): Promise<string[]> {
  opts.signal?.throwIfAborted();
  const puppeteer = await import("puppeteer-core");
  const executablePath = findChrome();
  if (!executablePath) throw new Error("No Chrome found for the storyboard — run `npx hyperframes browser ensure` or set CHROME_PATH");
  const { server, port } = await serve(dir);
  const shotDir = join(dir, "storyboard");
  await rm(shotDir, { recursive: true, force: true });
  await mkdir(shotDir, { recursive: true });
  const files: string[] = [];
  const browser = await puppeteer.default.launch({ executablePath, headless: true, args: CHROME_ARGS });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String((e as Error).message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForFunction(() => !!(window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.lesson, { timeout: 15000 });
    if (errors.length) throw new Error(`composition error: ${errors[0]}`);
    for (let i = 0; i < shots.length; i++) {
      opts.signal?.throwIfAborted();
      const s = shots[i];
      await page.evaluate(
        (t: number, label: string) => {
          const w = window as unknown as { __timelines: Record<string, { totalTime(t: number, s?: boolean): void }> };
          w.__timelines.lesson.totalTime(t, false);
          for (const a of document.getAnimations()) {
            a.currentTime = t * 1000;
            a.pause();
          }
          let tag = document.getElementById("__sb_label");
          if (!tag) {
            tag = document.createElement("div");
            tag.id = "__sb_label";
            tag.style.cssText =
              "position:fixed;left:0;top:0;z-index:9999;padding:10px 18px;background:rgba(0,0,0,.72);color:#fff;font:600 26px/1.2 monospace;";
            document.body.appendChild(tag);
          }
          tag.textContent = label;
        },
        s.t,
        s.label,
      );
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
      const file = join(shotDir, `shot-${String(i + 1).padStart(3, "0")}.png`);
      await page.screenshot({ path: file as `${string}.png` });
      files.push(file);
    }
    const failed3d = await page.evaluate(() => (window as unknown as { __LESSON_3D_FAILED__?: string }).__LESSON_3D_FAILED__);
    if (failed3d) {
      const message = `  3D scenes are blank: WebGL unavailable in this Chrome (${failed3d})`;
      if (opts.onWebglUnavailable) opts.onWebglUnavailable(message);
      else log.warn(message);
    }
  } finally {
    await browser.close();
    server.close();
  }
  await tile(shotDir, files.length, size, out);
  return files;
}

/**
 * Quick preview of a time range (default 12 fps, half resolution) with the
 * matching slice of audio.mp3 — for checking motion and narration sync
 * without a full HyperFrames render. Not frame-exact like the real render.
 */
export async function capturePreview(
  dir: string,
  range: { from: number; to: number; fps?: number; scale?: number },
  size: { w: number; h: number },
  out: string,
  opts: Pick<CaptureOptions, "signal"> = {},
): Promise<void> {
  opts.signal?.throwIfAborted();
  const fps = range.fps ?? 12;
  const scale = range.scale ?? 0.5;
  const puppeteer = await import("puppeteer-core");
  const executablePath = findChrome();
  if (!executablePath) throw new Error("No Chrome found for the preview — set CHROME_PATH");
  const { server, port } = await serve(dir);
  const frameDir = join(dir, "preview-frames");
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });
  const browser = await puppeteer.default.launch({ executablePath, headless: true, args: CHROME_ARGS });
  let n = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: scale });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForFunction(() => !!(window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.lesson, { timeout: 15000 });
    for (let t = range.from; t < range.to; t += 1 / fps) {
      opts.signal?.throwIfAborted();
      await page.evaluate((tt: number) => {
        const w = window as unknown as { __timelines: Record<string, { totalTime(t: number, s?: boolean): void }> };
        w.__timelines.lesson.totalTime(tt, false);
        for (const a of document.getAnimations()) {
          a.currentTime = tt * 1000;
          a.pause();
        }
      }, t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(true))));
      await page.screenshot({ path: join(frameDir, `f-${String(++n).padStart(5, "0")}.jpg`) as `${string}.jpg`, type: "jpeg", quality: 80 });
    }
  } finally {
    await browser.close();
    server.close();
  }
  const audio = join(dir, "audio.mp3");
  const args = ["-y", "-v", "error", "-framerate", String(fps), "-i", join(frameDir, "f-%05d.jpg")];
  if (existsSync(audio)) args.push("-ss", String(range.from), "-t", String(range.to - range.from), "-i", audio);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2");
  if (existsSync(audio)) args.push("-c:a", "aac", "-shortest");
  args.push(out);
  await new Promise<void>((ok, fail) => {
    const p = spawn(ffmpegBin(), args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", fail);
    p.on("close", (c) => (c === 0 ? ok() : fail(new Error(`preview encode failed: ${err}`))));
  });
  await rm(frameDir, { recursive: true, force: true });
}

function tile(shotDir: string, n: number, size: { w: number; h: number }, out: string): Promise<void> {
  const portrait = size.h > size.w;
  const cols = portrait ? Math.min(6, n) : Math.min(4, n);
  const rows = Math.ceil(n / cols);
  const tw = portrait ? 270 : 480;
  const th = Math.round((tw * size.h) / size.w);
  return new Promise((ok, fail) => {
    const p = spawn(ffmpegBin(), [
      "-y", "-v", "error", "-framerate", "1", "-i", join(shotDir, "shot-%03d.png"),
      "-vf", `scale=${tw}:${th},pad=${tw + 8}:${th + 8}:4:4:color=0x111111,tile=${cols}x${rows}`,
      "-frames:v", "1", "-q:v", "3", out,
    ]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", fail);
    p.on("close", (c) => (c === 0 ? ok() : fail(new Error(`storyboard tile failed: ${err}`))));
  });
}
