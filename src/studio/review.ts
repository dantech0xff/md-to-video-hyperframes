/**
 * Scene-by-scene view of a storyboard, for reviewing it in the desktop app:
 * what each frame shows, what the narrator says over it, when it plays and
 * its full-size image. The storyboard's plan.json says what was captured; the
 * current script supplies the narration.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildEntries, type EntryKind } from "../lesson/plan.js";
import { loadLessonScript } from "../lesson/pipeline.js";
import type { FormatName } from "../lesson/schema.js";

export interface StoryboardScene {
  /** position in the video, 0-based; the shot file is shot-<index + 1> */
  index: number;
  /** scene id from the script ("hook"), or "intro", "chapter-2", "outro" */
  key: string;
  kind: EntryKind;
  type: string;
  chapter: string;
  /** narration without cue markers */
  voice: string;
  /** seconds, when the storyboard has been built */
  start?: number;
  end?: number;
  /** absolute path of the full-size frame, when captured */
  shot?: string;
}

export interface StoryboardReview {
  format: FormatName;
  /** absolute path of storyboard.jpg, when it exists */
  storyboard?: string;
  duration?: number;
  /** the script changed after the storyboard was captured */
  stale: boolean;
  scenes: StoryboardScene[];
}

interface PlanScene {
  key: string;
  type: string;
  kind: EntryKind;
  start: number;
  end: number;
}

export async function storyboardReview(scriptPath: string, format: FormatName): Promise<StoryboardReview> {
  const script = await loadLessonScript(scriptPath);
  const formatDir = join(dirname(resolve(scriptPath)), format);
  const entries = new Map(buildEntries(script, format).map((e) => [e.key, e]));
  const storyboard = join(formatDir, "storyboard.jpg");
  const planFile = join(formatDir, "plan.json");

  if (!existsSync(planFile) || !existsSync(storyboard)) {
    return {
      format,
      stale: false,
      scenes: [...entries.values()].map((e, index) => ({ index, key: e.key, kind: e.kind, type: e.type, chapter: e.chapterTitle, voice: spoken(e.voice) })),
    };
  }

  const plan = JSON.parse(readFileSync(planFile, "utf8")) as { duration: number; scenes: PlanScene[] };
  const scenes = plan.scenes.map((p, index): StoryboardScene => {
    const entry = entries.get(p.key);
    const shot = join(formatDir, "storyboard", `shot-${String(index + 1).padStart(3, "0")}.png`);
    return {
      index,
      key: p.key,
      kind: p.kind,
      type: p.type,
      chapter: entry?.chapterTitle ?? "",
      voice: spoken(entry?.voice),
      start: p.start,
      end: p.end,
      shot: existsSync(shot) ? shot : undefined,
    };
  });
  return {
    format,
    storyboard,
    duration: plan.duration,
    stale: statSync(scriptPath).mtimeMs > statSync(storyboard).mtimeMs,
    scenes,
  };
}

/** Narration as spoken: cue markers like {1}, {L2-3}, {pause:2} removed. */
function spoken(voice: string | undefined): string {
  return (voice ?? "").replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
}
