/**
 * Structured events from the lesson pipeline, for callers that are not a
 * terminal: the Studio tools (agents) and the Get Frames desktop app. The
 * console log stays exactly as before; events are emitted alongside it.
 */
import { log } from "../utils/logger.js";
import type { FormatName } from "./schema.js";

/** Warnings with a stable code, so an agent can fix the script without parsing text. */
export type LessonWarningCode =
  /** a scene's beats reference a `{cue}` its narration does not contain */
  | "unknown-cue"
  /** an `energy.punch*` scene runs longer than ~1.8 s */
  | "punch-too-long"
  /** no file in the SFX library matched a timeline event or a requested name */
  | "no-sfx-match"
  /** the requested music track is not in the music library */
  | "music-not-found"
  /** neither SFX nor music on disk: placeholder sounds were generated */
  | "sound-library-empty"
  /** generating the placeholder sounds failed */
  | "starter-sounds-failed"
  /** no SFX on disk: the video has no sound effects */
  | "sfx-library-empty"
  /** `--silent`: no narration, word timings are estimated */
  | "no-narration"
  /** 3D scenes are blank in the storyboard (no WebGL in this Chrome) */
  | "webgl-unavailable";

export type LessonOutputKind = "storyboard" | "video" | "preview" | "captions" | "chapters" | "script";

export type LessonEvent =
  /** the formats this run makes, from the script as the run read it */
  | { type: "plan"; formats: FormatName[] }
  | { type: "step"; n: number; total: number; message: string }
  | { type: "info"; message: string }
  | { type: "warning"; code: LessonWarningCode; message: string; format?: FormatName; scene?: string }
  | { type: "progress"; stage: "narration" | "render"; percent: number; format?: FormatName; detail?: string }
  | { type: "output"; kind: LessonOutputKind; format: FormatName; path: string };

export interface Reporter {
  plan(formats: FormatName[]): void;
  step(n: number, total: number, message: string): void;
  info(message: string): void;
  warn(code: LessonWarningCode, message: string, where?: { format?: FormatName; scene?: string }): void;
  progress(stage: "narration" | "render", percent: number, extra?: { format?: FormatName; detail?: string }): void;
  output(kind: LessonOutputKind, format: FormatName, path: string): void;
}

/** Logs to the console as before and forwards each event to `onEvent`. */
export function createReporter(onEvent?: (e: LessonEvent) => void): Reporter {
  const emit = (e: LessonEvent) => {
    try {
      onEvent?.(e);
    } catch {
      // a failing listener must not break a render
    }
  };
  return {
    plan(formats) {
      emit({ type: "plan", formats: [...formats] });
    },
    step(n, total, message) {
      log.step(n, total, message);
      emit({ type: "step", n, total, message: message.trim() });
    },
    info(message) {
      log.info(message);
      emit({ type: "info", message: message.trim() });
    },
    warn(code, message, where) {
      log.warn(message);
      emit({ type: "warning", code, message: message.trim(), ...where });
    },
    progress(stage, percent, extra) {
      emit({ type: "progress", stage, percent, ...extra });
    },
    output(kind, format, path) {
      emit({ type: "output", kind, format, path });
    },
  };
}
