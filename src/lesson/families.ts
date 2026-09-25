/**
 * Template families. Every scene belongs to one; the family decides the
 * scene background, the shell (logo tone, NEWS tag, pills, progress colour)
 * and the karaoke caption colours. The runtime switches the shell when a
 * scene starts by setting data-* attributes on #root.
 */
import type { PlannedScene, LessonTimeline } from "./plan.js";

export type Family = "lesson" | "news" | "data" | "energy";

/** Full-bleed accent scenes; the rest of energy.* sit on the lesson background. */
const ENERGY_BLEED = new Set(["energy.punch", "energy.punch-3d", "energy.before-after"]);

/** Scene types drawn with three.js. */
export const THREE_TYPES = new Set(["3d.layers", "3d.hero-object", "3d.phone", "energy.punch-3d", "news.globe"]);

/** Lesson scenes that carry their own pills (or none): no pill row in the shell. */
const NO_SHELL_PILLS = new Set(["title", "image"]);

export function familyOf(type: string): Family {
  if (type.startsWith("news.")) return "news";
  if (type.startsWith("data.")) return "data";
  if (ENERGY_BLEED.has(type)) return "energy";
  return "lesson";
}

export interface ShellState {
  family: Family;
  /** lesson pill row + chapter pill */
  pills: boolean;
  /** captions sit above the news ticker */
  ticker: boolean;
  /** "white": the whole wordmark in white (accent backgrounds) */
  logo: "brand" | "white";
}

export function shellState(scene: Pick<PlannedScene, "kind" | "type" | "spec">, portrait: boolean): ShellState {
  const family = familyOf(scene.type);
  const spec = scene.spec as { ticker?: unknown[] } | undefined;
  const ticker = family === "news" && hasTicker(scene.type, !!spec?.ticker?.length, portrait);
  const pills = scene.kind === "scene" && family === "lesson" && !NO_SHELL_PILLS.has(scene.type);
  // before/after in 9:16: the logo sits on the dark half
  const logo = family === "energy" && !(portrait && scene.type === "energy.before-after") ? "white" : "brand";
  return { family, pills, ticker, logo };
}

/** Whether a news scene draws its ticker bar (the 9:16 globe has no room for one). */
export function hasTicker(type: string, items: boolean, portrait: boolean): boolean {
  if (type === "news.quote") return !portrait || items;
  if (type === "news.globe") return !portrait && items;
  return items;
}

export const usesThree = (timeline: LessonTimeline) => timeline.scenes.some((s) => THREE_TYPES.has(s.type));
