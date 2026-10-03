/**
 * Scene-by-scene view of a storyboard, for reviewing it in the desktop app:
 * what each frame shows, what the narrator says over it, when it plays and
 * its full-size image. The scenes are the current script's; the storyboard's
 * plan.json says which were captured, and when they play.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { outputCurrent } from "../lesson/inputs.js";
import { lookInside, readInside } from "../utils/inside.js";
import { buildEntries, type EntryKind, type SceneEntry } from "../lesson/plan.js";
import { parseLessonScript } from "../lesson/pipeline.js";
import type { FormatName } from "../lesson/schema.js";
import { parseVoice } from "../lesson/voice-text.js";

export interface StoryboardScene {
  /** position in the video as the script has it now, 0-based */
  index: number;
  /** scene id from the script ("hook"), or "intro", "chapter-2", "outro" */
  key: string;
  kind: EntryKind;
  type: string;
  chapter: string;
  /** which chapter the entry belongs to (chapter cards name their own) */
  chapterIndex: number;
  /** narration without cue markers */
  voice: string;
  /** seconds, when the storyboard has the scene */
  start?: number;
  end?: number;
  /** absolute path of the full-size frame, when captured (a scene added since has none) */
  shot?: string;
  /** the part is in the script but the render skips it (disabled outro, skipped intro) */
  off?: boolean;
}

export interface StoryboardReview {
  format: FormatName;
  /** absolute path of storyboard.jpg, when it exists */
  storyboard?: string;
  duration?: number;
  /** the script, or an image it shows, changed since the storyboard was made from them */
  stale: boolean;
  scenes: StoryboardScene[];
  /** fingerprint of the script as read; edits and moves check it */
  version: string;
}

interface PlanScene {
  key: string;
  type: string;
  kind: EntryKind;
  start: number;
  end: number;
}

/**
 * `root`: the project folder, when the script is an agent's. Every file is
 * then looked up inside it only: a link out of it is never followed, and
 * images outside it are never shown, nor looked up.
 */
export async function storyboardReview(scriptPath: string, format: FormatName, root?: string): Promise<StoryboardReview> {
  const exists = (p: string) => (root === undefined ? existsSync(p) : !!lookInside(root, p));
  const readText = (p: string) => (root === undefined ? readFileSync(p, "utf8") : readInside(root, p, relative(root, p)).data.toString("utf8"));
  // the keys and the version edits check them against come from one read: a write between two reads would pair old keys with a newer version
  const text = readText(scriptPath);
  const script = parseLessonScript(text);
  const version = fingerprint(text);
  const formatDir = join(dirname(resolve(scriptPath)), format);
  // a part switched off is still a part of the script, one the user edits to switch it back:
  // a chapter card set off (`card: false`) is listed where it would play — when it can play at all, its
  // place found as the plan finds it —, an outro that is disabled, an intro the format skips ("none", or a portrait "auto")
  const cardOff = (ci: number) => script.chapters[ci]?.card === false;
  const entries = buildEntries({ ...script, chapters: script.chapters.map((ch, ci) => (cardOff(ci) ? { ...ch, card: true } : ch)) }, format);
  const introOff = !entries.some((e) => e.kind === "intro");
  if (introOff) {
    entries.unshift({ key: "intro", kind: "intro", type: "intro", chapterIndex: 0, chapterTitle: script.chapters[0]?.title ?? "", transition: "auto" });
  }
  if (!script.outro.enabled) {
    entries.push({
      key: "outro",
      kind: "outro",
      type: "outro",
      chapterIndex: script.chapters.length - 1,
      chapterTitle: script.chapters[script.chapters.length - 1]?.title ?? "",
      voice: script.outro.voice,
      transition: "auto",
    });
  }
  const off = (e: SceneEntry) => (e.kind === "intro" && introOff) || (e.kind === "outro" && !script.outro.enabled) || (e.kind === "chapter" && cardOff(e.chapterIndex)) || undefined;
  const storyboard = join(formatDir, "storyboard.jpg");
  const planFile = join(formatDir, "plan.json");

  if (!exists(planFile) || !exists(storyboard)) {
    return {
      format,
      stale: false,
      scenes: entries.map((e, index) => ({ index, key: e.key, kind: e.kind, type: e.type, chapter: e.chapterTitle, chapterIndex: e.chapterIndex, voice: spoken(e.voice), off: off(e) })),
      version,
    };
  }

  const plan = JSON.parse(readText(planFile)) as { duration: number; scenes: PlanScene[] };
  const stale = !outputCurrent(storyboard, scriptPath, root);
  // a key made from a place ("s3", "chapter-2") may name another part once the script changed: then only a scene
  // with its own id, the intro and the outro keep the frame they were captured with
  const same = (e: SceneEntry) => !stale || e.kind === "intro" || e.kind === "outro" || (e.kind === "scene" && e.spec?.id !== undefined);
  // the scenes as the script has them now: one the storyboard has keeps its frame and timing, one added since has none yet
  const captured = new Map(plan.scenes.map((p, at) => [p.key, { p, at }] as const));
  const scenes = entries.map((e, index): StoryboardScene => {
    // a part switched off plays nowhere: no frame or timing, though an earlier capture had it on
    const was = !off(e) && same(e) ? captured.get(e.key) : undefined;
    const shot = was && join(formatDir, "storyboard", `shot-${String(was.at + 1).padStart(3, "0")}.png`);
    return {
      index,
      key: e.key,
      kind: e.kind,
      type: e.type,
      chapter: e.chapterTitle,
      chapterIndex: e.chapterIndex,
      voice: spoken(e.voice),
      start: was?.p.start,
      end: was?.p.end,
      shot: shot && exists(shot) ? shot : undefined,
      off: off(e),
    };
  });
  return { format, storyboard, duration: plan.duration, stale, scenes, version };
}

/**
 * Narration as spoken: the cue markers TTS drops ({1}, {L2-3}, {pause:2})
 * removed, and nothing else — braces that are not a marker ("{it * 2}") are
 * read out, so they stay.
 */
function spoken(voice: string | undefined): string {
  return parseVoice(voice ?? "").display;
}

/** The script's fingerprint as script-edit.ts has it — the version edits check. */
function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
