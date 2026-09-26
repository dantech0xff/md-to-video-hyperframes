/**
 * What a script's outputs (storyboard, video) are made from: the script and
 * the local images its scenes show. An output older than any of them is out
 * of date. An image counts from when its file last changed or was replaced
 * (its ctime too): a copy that kept an older modification time is still a
 * new file.
 *
 * A storyboard and a rendered video also keep a record of what they were made
 * from (the script's text, and each image, as the run read them): a script or
 * an image changed while the run went on is newer than what the output shows,
 * however their times compare.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync, type Stats } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lookInside, readInside, within, writeInside } from "../utils/inside.js";
import { LessonScriptSchema, type LessonScript } from "./schema.js";

/**
 * The fields that name an image (a file relative to the script, or a URL),
 * by scene type as scripts write it. The desktop app's project list reads the
 * same ones from the script's JSON, and the catalog ids that alias classic
 * scenes have none.
 */
export const SCENE_IMAGE_FIELDS: Record<string, string[]> = {
  phone: ["image"],
  image: ["src"],
  "news.breaking": ["image"],
  "news.quote": ["avatar"],
  "news.lower-third": ["media"],
  "3d.phone": ["image"],
};

/**
 * Absolute paths of the local images the script's scenes show; URLs left out.
 * With `root` (the project folder of an agent's script), only those inside it
 * as written: the run refuses any other, and looking one up could reach
 * another machine (a network path such as \\host\share on Windows).
 */
export function scriptImages(script: LessonScript, scriptPath: string, root?: string): string[] {
  const dir = dirname(resolve(scriptPath));
  const images = new Set<string>();
  for (const chapter of script.chapters) {
    for (const scene of chapter.scenes) {
      for (const field of SCENE_IMAGE_FIELDS[scene.type] ?? []) {
        const value = (scene as Record<string, unknown>)[field];
        // a URL scheme ("https:"), not a Windows drive ("C:\")
        if (typeof value !== "string" || !value || (/^[a-z][a-z\d+.-]*:/i.test(value) && !isAbsolute(value))) continue;
        const image = resolve(dir, value);
        if (root === undefined || within(resolve(root), image)) images.add(image);
      }
    }
  }
  return [...images];
}

/**
 * When the image at `path` last changed and which file it is, looked up as the
 * run reads it; with `root`, inside it only (a link out of it is never
 * followed). Undefined when missing or leading outside.
 */
function imageNow(path: string, root?: string): { changedAt: number; fileId: string } | undefined {
  const real = root === undefined ? path : lookInside(root, path)?.real;
  const st = real === undefined ? undefined : statSync(real, { throwIfNoEntry: false });
  const id = real === undefined ? undefined : statSync(real, { bigint: true, throwIfNoEntry: false });
  // times as the run takes them (fractional ms), the file by its inode number
  return st && id ? { changedAt: Math.max(st.mtimeMs, st.ctimeMs), fileId: String(id.ino) } : undefined;
}

/** When one of `images` last changed (ms): 0 without any, Infinity when one is missing. `root`: as for imageNow. */
export function imagesChangedAt(images: string[], root?: string): number {
  let at = 0;
  for (const image of images) {
    const now = imageNow(image, root);
    if (!now) return Infinity;
    at = Math.max(at, now.changedAt);
  }
  return at;
}

/** When the script or one of `images` last changed (ms); Infinity when one is missing, so nothing made from them counts as current. */
export function inputsChangedAt(scriptPath: string, images: string[], root?: string): number {
  const script = lookUp(scriptPath, root);
  if (!script) return Infinity;
  return Math.max(script.mtimeMs, imagesChangedAt(images, root));
}

/** What an output was made from, kept beside it as <name>.inputs.json (storyboard.inputs.json). */
export interface MadeFrom {
  /** sha256 of the script's text as the run read it */
  script: string;
  /** each local image the output shows, by its path from the script's folder ("/" between names), as the run read it */
  images: Record<string, SeenImage>;
}

/** An image as the run read it. */
export interface SeenImage {
  /** when its file last changed (ms) */
  changedAt: number;
  /** which file it was (its inode number): another file put at its path, or a link switched to one, is not it, whatever its times; "" when the run read two */
  fileId: string;
}

/** What an output of the script, read as `text`, is made from: that text, and each image as the run reads it (seenImage). */
export function madeFrom(text: string): MadeFrom {
  // keyed by file names, "__proto__" and "constructor" included
  return { script: fingerprint(text), images: Object.create(null) as Record<string, SeenImage> };
}

/**
 * The run read `image` (an absolute path) in the version that last changed at
 * `changedAt`, from file `fileId`: the one the output shows. Read again (the
 * script spells its path two ways), the output shows both reads: the earliest
 * time counts, and two different files never match one now.
 */
export function seenImage(made: MadeFrom, scriptPath: string, image: string, changedAt: number, fileId: string): void {
  const path = relative(dirname(resolve(scriptPath)), image).split(sep).join("/");
  const before = Object.hasOwn(made.images, path) ? made.images[path] : undefined;
  made.images[path] = before ? { changedAt: Math.min(before.changedAt, changedAt), fileId: before.fileId === fileId ? fileId : "" } : { changedAt, fileId };
}

/** Where the record of what `output` was made from is kept: storyboard.jpg, storyboard.inputs.json. */
export function madeFromFile(output: string): string {
  return join(dirname(output), `${basename(output, extname(output))}.inputs.json`);
}

/**
 * Keeps beside `output` the record of what it was made from. With `root` (the
 * project folder of an agent's script), through a new file checked inside it
 * (writeInside): the capture or render before it takes a while, time enough
 * for another process to switch the output's folder for a link.
 */
export function writeMadeFrom(output: string, made: MadeFrom, root?: string): void {
  const file = madeFromFile(output);
  if (root === undefined) writeFileSync(file, JSON.stringify(made));
  else writeInside(root, file, JSON.stringify(made));
}

/**
 * Whether `output` shows the script at `scriptPath`, and the images it shows,
 * as they are now: made from the same text, and each image it read still the
 * same file, not changed since. An output without that record (made before
 * it was kept) counts by time: not older than the script or an image.
 * `root` (the project folder of an agent's script): every file is looked up
 * inside it only, a link out of it never followed, and a recorded image
 * outside it is not current (the record is a file in the project, which the
 * agent can write too).
 */
export function outputCurrent(output: string, scriptPath: string, root?: string): boolean {
  const st = lookUp(output, root);
  const text = st ? readText(scriptPath, root) : undefined;
  if (!st || text === undefined) return false;
  const made = readMadeFrom(output, root);
  if (!made) return st.mtimeMs >= inputsChangedAt(scriptPath, imagesOf(text, scriptPath, root), root);
  if (made.script !== fingerprint(text)) return false;
  const dir = dirname(resolve(scriptPath));
  return Object.entries(made.images).every(([path, seen]) => {
    const image = resolve(dir, path);
    if (root !== undefined && !within(resolve(root), image)) return false;
    const now = imageNow(image, root);
    return !!now && now.fileId === seen.fileId && now.changedAt <= seen.changedAt;
  });
}

/** The file at `path` (with `root`, inside it only); undefined when missing or leading outside. */
function lookUp(path: string, root?: string): Stats | undefined {
  return root === undefined ? statSync(path, { throwIfNoEntry: false }) : lookInside(root, path)?.st;
}

/** The text of the file at `path` (with `root`, read inside it only: readInside); undefined when it cannot be read. */
function readText(path: string, root?: string): string | undefined {
  try {
    return root === undefined ? readFileSync(path, "utf8") : readInside(root, path, basename(path)).data.toString("utf8");
  } catch {
    return undefined;
  }
}

function readMadeFrom(output: string, root?: string): MadeFrom | undefined {
  const text = readText(madeFromFile(output), root);
  if (text === undefined) return undefined;
  try {
    const made = JSON.parse(text) as { script?: unknown; images?: unknown };
    const images = made.images;
    if (typeof made.script !== "string" || !images || typeof images !== "object" || Array.isArray(images)) return undefined;
    const seen = Object.values(images) as Partial<SeenImage>[];
    if (!seen.every((s) => !!s && typeof s === "object" && typeof s.changedAt === "number" && typeof s.fileId === "string")) return undefined;
    return { script: made.script, images: images as Record<string, SeenImage> };
  } catch {
    return undefined;
  }
}

/** The local images a script's text shows, when it parses (none otherwise: the script's own time decides). */
function imagesOf(text: string, scriptPath: string, root?: string): string[] {
  try {
    const parsed = LessonScriptSchema.safeParse(JSON.parse(text));
    return parsed.success ? scriptImages(parsed.data, scriptPath, root) : [];
  } catch {
    return [];
  }
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
