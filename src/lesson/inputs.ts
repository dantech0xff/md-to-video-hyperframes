/**
 * What a script's outputs (storyboard, video) are made from: the script and
 * the local images its scenes show. An output older than any of them is out
 * of date. An image counts from when its file last changed or was replaced
 * (its ctime too): a copy that kept an older modification time is still a
 * new file.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
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

/** Absolute paths of the local images the script's scenes show; URLs left out. */
export function scriptImages(script: LessonScript, scriptPath: string): string[] {
  const dir = dirname(resolve(scriptPath));
  const images = new Set<string>();
  for (const chapter of script.chapters) {
    for (const scene of chapter.scenes) {
      for (const field of SCENE_IMAGE_FIELDS[scene.type] ?? []) {
        const value = (scene as Record<string, unknown>)[field];
        // a URL scheme ("https:"), not a Windows drive ("C:\")
        if (typeof value !== "string" || !value || (/^[a-z][a-z\d+.-]*:/i.test(value) && !isAbsolute(value))) continue;
        images.add(resolve(dir, value));
      }
    }
  }
  return [...images];
}

/** When the script or one of `images` last changed (ms); Infinity when one is missing, so nothing made from them counts as current. */
export function inputsChangedAt(scriptPath: string, images: string[]): number {
  const script = statSync(scriptPath, { throwIfNoEntry: false });
  if (!script) return Infinity;
  let at = script.mtimeMs;
  for (const image of images) {
    const st = statSync(image, { throwIfNoEntry: false });
    if (!st) return Infinity;
    at = Math.max(at, st.mtimeMs, st.ctimeMs);
  }
  return at;
}

/** inputsChangedAt for a script file, with the images it shows when it parses. */
export function scriptInputsChangedAt(scriptPath: string): number {
  let images: string[] = [];
  try {
    const parsed = LessonScriptSchema.safeParse(JSON.parse(readFileSync(scriptPath, "utf8")));
    if (parsed.success) images = scriptImages(parsed.data, scriptPath);
  } catch {
    // unreadable: the script's own time decides
  }
  return inputsChangedAt(scriptPath, images);
}
