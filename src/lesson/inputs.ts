/**
 * What a script's outputs (storyboard, video) are made from: the script and
 * the local images its scenes show. An output older than any of them is out
 * of date. An image counts from when its file last changed or was replaced
 * (its ctime too): a copy that kept an older modification time is still a
 * new file.
 *
 * A storyboard also keeps a record of what it was made from (the script's
 * text as the run read it): a script changed while the run went on is newer
 * than what the storyboard shows, however their times compare.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { within } from "../utils/inside.js";
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

/** When one of `images` last changed (ms): 0 without any, Infinity when one is missing. */
export function imagesChangedAt(images: string[]): number {
  let at = 0;
  for (const image of images) {
    const st = statSync(image, { throwIfNoEntry: false });
    if (!st) return Infinity;
    at = Math.max(at, st.mtimeMs, st.ctimeMs);
  }
  return at;
}

/** When the script or one of `images` last changed (ms); Infinity when one is missing, so nothing made from them counts as current. */
export function inputsChangedAt(scriptPath: string, images: string[]): number {
  const script = statSync(scriptPath, { throwIfNoEntry: false });
  if (!script) return Infinity;
  return Math.max(script.mtimeMs, imagesChangedAt(images));
}

/** What an output was made from, kept beside it as <name>.inputs.json (storyboard.inputs.json). */
export interface MadeFrom {
  /** sha256 of the script's text as the run read it */
  script: string;
  /** each local image the output shows, by its path from the script's folder ("/" between names): when its file last changed, as the run read it (ms) */
  images: Record<string, number>;
}

/** What an output of the script, read as `text`, is made from: that text, and each image as the run reads it (seenImage). */
export function madeFrom(text: string): MadeFrom {
  return { script: fingerprint(text), images: {} };
}

/** The run read `image` (an absolute path) in the version that last changed at `changedAt`: the one the output shows. */
export function seenImage(made: MadeFrom, scriptPath: string, image: string, changedAt: number): void {
  made.images[relative(dirname(resolve(scriptPath)), image).split(sep).join("/")] = changedAt;
}

/** Where the record of what `output` was made from is kept: storyboard.jpg, storyboard.inputs.json. */
export function madeFromFile(output: string): string {
  return join(dirname(output), `${basename(output, extname(output))}.inputs.json`);
}

/**
 * Whether `output` shows the script at `scriptPath`, and the images it shows,
 * as they are now: made from the same text, and each image it read not
 * changed since. An output without that record (made before it was kept)
 * counts by time: not older than the script or an image. `root`: as for
 * scriptImages; a recorded image outside it is never looked up (the record
 * is a file in the project, which the agent can write too).
 */
export function outputCurrent(output: string, scriptPath: string, root?: string): boolean {
  const st = statSync(output, { throwIfNoEntry: false });
  if (!st) return false;
  let text: string;
  try {
    text = readFileSync(scriptPath, "utf8");
  } catch {
    return false;
  }
  const made = readMadeFrom(output);
  if (!made) return st.mtimeMs >= inputsChangedAt(scriptPath, imagesOf(text, scriptPath, root));
  if (made.script !== fingerprint(text)) return false;
  const dir = dirname(resolve(scriptPath));
  return Object.entries(made.images).every(([path, readAt]) => {
    const image = resolve(dir, path);
    if (root !== undefined && !within(resolve(root), image)) return false;
    const now = statSync(image, { throwIfNoEntry: false });
    return !!now && Math.max(now.mtimeMs, now.ctimeMs) <= readAt;
  });
}

function readMadeFrom(output: string): MadeFrom | undefined {
  try {
    const made = JSON.parse(readFileSync(madeFromFile(output), "utf8")) as Partial<MadeFrom>;
    const images = made.images;
    if (typeof made.script !== "string" || !images || typeof images !== "object" || Array.isArray(images)) return undefined;
    if (!Object.values(images).every((at) => typeof at === "number")) return undefined;
    return { script: made.script, images };
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
