/**
 * Narration markup: `{marker}` cues and `{pause:N}` silences inside `voice`.
 *
 * parseVoice() strips the markers, splits the narration at pauses into TTS
 * segments, and records where each cue sits (character offset in the clean
 * segment text) so it can later be converted to a timestamp using the TTS
 * word timings.
 */

export interface Cue {
  name: string;
  /** character offset in the segment's clean text (cue fires at the next word) */
  offset: number;
}

export interface VoiceSegment {
  /** clean text to synthesize (may be "" for a pure-silence segment) */
  text: string;
  cues: Cue[];
  /** seconds of silence after this segment */
  pauseAfter: number;
}

export interface ParsedVoice {
  segments: VoiceSegment[];
  /** clean narration, pauses removed — used for captions and script.txt */
  display: string;
}

const MARKER = /\{([^{}\n]{1,60})\}/g;
const CUE_NAME = /^[\p{L}\p{N}_.:>,-]+$/u;
const DEFAULT_PAUSE = 1;

export function parseVoice(raw: string): ParsedVoice {
  const segments: VoiceSegment[] = [];
  let buf = "";
  let cues: Cue[] = [];

  const append = (chunk: string) => {
    let c = chunk.replace(/\s+/g, " ");
    if ((buf === "" || buf.endsWith(" ")) && c.startsWith(" ")) c = c.slice(1);
    buf += c;
  };
  const flush = (pauseAfter: number) => {
    const lead = buf.length - buf.trimStart().length;
    const text = buf.trim();
    segments.push({
      text,
      cues: cues.map((c) => ({ name: c.name, offset: Math.min(Math.max(c.offset - lead, 0), text.length) })),
      pauseAfter,
    });
    buf = "";
    cues = [];
  };

  let last = 0;
  for (const m of raw.matchAll(MARKER)) {
    const body = m[1].trim();
    const pause = body.match(/^pause(?::\s*(\d+(?:\.\d+)?))?$/i);
    if (!pause && !CUE_NAME.test(body)) continue; // not a marker → keep as literal text
    append(raw.slice(last, m.index));
    last = m.index! + m[0].length;
    if (pause) {
      const secs = pause[1] ? Number(pause[1]) : DEFAULT_PAUSE;
      flush(Math.min(Math.max(secs, 0.2), 12));
    } else {
      cues.push({ name: body, offset: buf.length });
    }
  }
  append(raw.slice(last));
  flush(0);

  // drop a trailing empty segment created by a final {pause} with nothing after it
  while (segments.length > 1 && segments[segments.length - 1].text === "" && segments[segments.length - 1].cues.length === 0) {
    const empty = segments.pop()!;
    segments[segments.length - 1].pauseAfter += empty.pauseAfter;
  }

  return {
    segments,
    display: segments.map((s) => s.text).filter(Boolean).join(" "),
  };
}

/** What a cue name asks the scene to do. */
export type CueAction =
  | { kind: "item"; index: number }
  | { kind: "lines"; lines: number[] }
  | { kind: "action"; verb: "show" | "hl" | "flow" | "tap" | "check" | "zoom" | "type"; arg: string }
  | { kind: "answer" }
  | { kind: "named"; name: string };

const VERBS = new Set(["show", "hl", "flow", "tap", "check", "zoom", "type"]);

export function interpretCue(name: string): CueAction {
  if (/^\d+$/.test(name)) return { kind: "item", index: Number(name) };
  const lineSpec = name.match(/^L(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/);
  if (lineSpec) return { kind: "lines", lines: parseLineSpec(lineSpec[1]) };
  if (name.toLowerCase() === "answer") return { kind: "answer" };
  const verb = name.match(/^([a-z]+):(.+)$/);
  if (verb && VERBS.has(verb[1])) {
    return { kind: "action", verb: verb[1] as "show", arg: verb[2] };
  }
  return { kind: "named", name };
}

/** "3", "3-5", "3-5,8" → [3,4,5,8] (1-based, sorted, unique). */
export function parseLineSpec(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 200; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}
