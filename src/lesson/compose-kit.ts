/**
 * Shared pieces for scene renderers: the render context, the brand wordmark,
 * pills, keyword emphasis, the news ticker and media copying.
 */
import { randomBytes } from "node:crypto";
import { constants, existsSync, readFileSync, realpathSync, type BigIntStats } from "node:fs";
import { copyFile, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { assertRealInside, within } from "../utils/inside.js";
import type { FormatName, LessonScript } from "./schema.js";
import type { LessonTimeline, CaptionGroup } from "./plan.js";
import type { StylePack } from "./styles.js";
import type { BrandKit } from "./brand.js";
import { esc, inline } from "./markup.js";
import { iconSvg } from "./icons.js";

export interface ComposeInput {
  /** browser runtime source, inlined so HyperFrames sees the timeline registration */
  runtimeJs: string;
  script: LessonScript;
  format: FormatName;
  timeline: LessonTimeline;
  style: StylePack;
  brand: BrandKit;
  captions: CaptionGroup[] | null;
  scriptDir: string;
  outDir: string;
  audioFile: string;
  /** when set, images are files inside this folder: no URLs, no links out of it (LessonRunOptions.assetRoot) */
  assetRoot?: string;
}

export interface Ctx extends ComposeInput {
  box: { x: number; y: number; w: number; h: number };
  portrait: boolean;
  assets: Map<string, string>;
}

export interface Rendered {
  html: string;
  meta?: Record<string, unknown>;
  /** full-frame background drawn inside the scene (template families) */
  bg?: string;
}

export const LEVEL_LABEL: Record<string, string> = { beginner: "Cơ bản", intermediate: "Trung cấp", advanced: "Nâng cao" };

/** PNG aspect ratio from the IHDR chunk (width/height). */
function pngAspect(path: string): number {
  try {
    const b = readFileSync(path);
    return b.readUInt32BE(16) / b.readUInt32BE(20);
  } catch {
    return 2.2;
  }
}

/**
 * Brand logo: the text wordmark when the brand defines one, else the PNG as a
 * background-image block (several <img> with one src confuse HyperFrames media discovery).
 */
export function logoBlock(ctx: Ctx, cls: string): string {
  const wm = ctx.brand.wordmark;
  if (wm?.length) {
    const parts = wm
      .map((p) => (p.color ? `<span class="wm-part wm-accent" style="--wm-c:${esc(p.color)}">${esc(p.text)}</span>` : `<span class="wm-part">${esc(p.text)}</span>`))
      .join(" ");
    return `<div class="brand-logo brand-wordmark ${cls}" role="img" aria-label="${esc(ctx.brand.name)}">${parts}</div>`;
  }
  const file = ctx.style.theme === "light" ? ctx.brand.logo.onLight : ctx.brand.logo.onDark;
  const ratio = pngAspect(join(ctx.brand.dir, file)).toFixed(4);
  return `<div class="brand-logo ${cls}" role="img" aria-label="${esc(ctx.brand.name)}" style="background-image:url('brand/${esc(file)}');aspect-ratio:${ratio}"></div>`;
}

export const icon = (ref: string | undefined, cls = ""): string => {
  const svg = iconSvg(ref);
  return svg ? `<span class="icon ${cls}">${svg}</span>` : "";
};

export const sceneTitle = (t?: string, keyword?: string) => (t ? `<h2 class="scene-title">${withKeyword(t, keyword)}</h2>` : "");

/**
 * Inline markup plus the keyword: its first occurrence becomes accent emphasis.
 * A keyword that also carries `*…*` markup is left as written.
 */
export function withKeyword(text: string, keyword?: string, cls = "kw"): string {
  const html = inline(text);
  if (!keyword) return html;
  const k = esc(keyword);
  const i = html.indexOf(k);
  if (i < 0) return html;
  // the hook beat sweeps an accent bar across the keyword (hidden otherwise)
  const inner = cls === "kw" ? `<span class="kw-bar"></span><span class="kw-text">${k}</span>` : k;
  // punctuation right after the keyword stays on its line
  const rest = html.slice(i + k.length);
  const punct = rest.match(/^[.,!?:;…)]+/)?.[0] ?? "";
  const em = `<em class="${cls}">${inner}</em>`;
  return `${html.slice(0, i)}${punct ? `<span class="kw-glue">${em}${punct}</span>` : em}${rest.slice(punct.length)}`;
}

/** Category pills; the first one is filled with the accent. */
export function pillRow(pills: string[], cls = ""): string {
  if (!pills.length) return "";
  return `<div class="pills ${cls}">${pills.map((p, i) => `<span class="pill${i === 0 ? " pill--main" : ""}">${esc(p)}</span>`).join("")}</div>`;
}

/** The lesson's pills: `lesson.pills`, else "Bài học" plus the level. */
export function lessonPills(script: LessonScript): string[] {
  const L = script.lesson;
  return L.pills ?? ["Bài học", ...(L.level ? [LEVEL_LABEL[L.level]] : [])];
}

/** News ticker bar: an accent label block and crawling items. */
export function tickerBar(items: string[], label: string): string {
  const row = items.map((t) => `<span class="ticker-item">${esc(t)}</span>`).join("");
  // the second copy only shows when the row overflows and crawls (runtime decides)
  return `<div class="ticker"><div class="ticker-label">${esc(label)}</div><div class="ticker-track"><div class="ticker-row"><span class="ticker-run">${row}</span><span class="ticker-run ticker-dup" aria-hidden="true">${row}</span></div></div></div>`;
}

export async function useAsset(ctx: Ctx, src: string): Promise<string> {
  const hit = ctx.assets.get(src);
  if (hit) return hit;
  const media = join(ctx.outDir, "media");
  if (ctx.assetRoot) {
    confined(ctx.assetRoot, src, resolve(ctx.scriptDir, src));
    assertRealInside(ctx.assetRoot, media);
  }
  await mkdir(media, { recursive: true });
  const name = `${ctx.assets.size + 1}-${basename(src).replace(/[^a-zA-Z0-9._-]/g, "_")}`.slice(0, 80);
  const rel = `media/${name}${extname(name) ? "" : ".img"}`;
  const out = join(ctx.outDir, rel);
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`image download failed (${res.status}): ${src}`);
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
  } else {
    const path = isAbsolute(src) ? src : resolve(ctx.scriptDir, src);
    if (!existsSync(path)) throw new Error(`image not found: ${path}`);
    if (ctx.assetRoot) await writeConfined(ctx.assetRoot, out, await readConfined(ctx.assetRoot, src, path));
    else await copyFile(path, out);
  }
  ctx.assets.set(src, rel);
  return rel;
}

const CONFINED_HINT = "use a file inside the project folder, for example sources/photo.jpg";

/**
 * An image named by a script that an agent wrote (Studio tools, the desktop
 * app): only a file inside the project folder. Copying any other path would
 * put a file from elsewhere on the machine in the project, and a URL would
 * reach the network, both without asking the user.
 */
function confined(root: string, src: string, path: string): void {
  const hint = CONFINED_HINT;
  // a URL scheme ("https:", "file:"), not a Windows drive ("C:\")
  if (/^[a-z][a-z\d+.-]*:/i.test(src) && !isAbsolute(src)) throw new Error(`image "${src}" is a link: ${hint}`);
  if (!within(root, path)) throw new Error(`image "${src}" is outside the project folder: ${hint}`);
  let real: string | undefined;
  try {
    real = realpathSync(path);
  } catch {
    // missing: reported as "image not found"
  }
  if (real && !within(realpathSync(root), real)) throw new Error(`image "${src}" leads outside the project folder through a symbolic link: ${hint}`);
}

/**
 * Reads an agent's image from the file it opens, checked once it is open: a
 * regular file (a pipe or a device could stall the engine), and its path must
 * still lead inside the project, to that very file. Checking the path and
 * then reading it would let a symbolic link switched in between (by another
 * process of the agent's) take the copy from outside the project.
 */
async function readConfined(root: string, src: string, path: string): Promise<Buffer> {
  // opening a named pipe waits for a writer unless non-blocking (no such flag on Windows)
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile()) throw new Error(`image "${src}" is not a regular file: ${CONFINED_HINT}`);
    confined(root, src, path);
    let now: BigIntStats | undefined;
    try {
      now = await stat(realpathSync(path), { bigint: true });
    } catch {
      // gone since it was opened
    }
    if (!now || now.dev !== opened.dev || now.ino !== opened.ino) throw new Error(`image "${src}" changed while it was copied: ${CONFINED_HINT}`);
    return await file.readFile();
  } finally {
    await file.close();
  }
}

/**
 * Writes an agent's image to `out` through a new file under a random name,
 * checked once it exists: the output folder could have been switched for a
 * symbolic link out of the project (by another process of the agent's) since
 * it was checked. The image and its name only ever land inside the project;
 * elsewhere at most the empty new file is made, and it is removed.
 */
async function writeConfined(root: string, out: string, data: Uint8Array): Promise<void> {
  const tmp = join(dirname(out), `.${randomBytes(8).toString("hex")}.tmp`);
  const file = await open(tmp, "wx");
  let real: string | undefined;
  let placed = false;
  try {
    const made = await file.stat({ bigint: true });
    let now: BigIntStats | undefined;
    try {
      real = realpathSync(tmp);
      now = await stat(real, { bigint: true });
    } catch {
      // moved since it was made
    }
    if (!real || !now || now.dev !== made.dev || now.ino !== made.ino || !within(realpathSync(root), real)) {
      throw new Error(`${dirname(out)} leads outside the project folder through a symbolic link; remove the link and run again`);
    }
    await file.writeFile(data);
    await file.close();
    await rename(tmp, out);
    placed = true;
  } finally {
    if (!placed) {
      await file.close().catch(() => {});
      await rm(real ?? tmp, { force: true }).catch(() => {});
    }
  }
}

/** Numbers the way Vietnamese readers write them: 1.640 and 4,2. */
export function viNumber(n: number, decimals = 0): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "−" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

/** Seeded PRNG for decorative randomness (same input → same frames). */
export function prng(seed: number): () => number {
  let s = seed % 2147483647 || 7;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export const r3 = (x: number) => Math.round(x * 1000) / 1000;
