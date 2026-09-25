/**
 * Lesson planning:
 *   1. buildEntries()  — the ordered scene list for one format, including the
 *                        auto scenes (brand intro, chapter cards, outro)
 *   2. prepareVoice()  — parse markers, apply the lexicon (offset-mapped)
 *   3. buildTimeline() — absolute timing for every scene, narration segment,
 *                        cue, beat, pause and caption word
 *   4. buildSfxEvents()— sound events on the timeline (transitions, reveals…)
 */
import type { FormatName, LessonScript, SceneSpec, TransitionName } from "./schema.js";
import type { StylePack } from "./styles.js";
import { parseVoice, interpretCue, parseLineSpec, type ParsedVoice, type CueAction } from "./voice-text.js";
import { applyLexicon, type Lexicon } from "../tts/lexicon.js";
import { alignWords, timeAtOffset, type AlignedWord, type WordTiming } from "./timing.js";

export type EntryKind = "scene" | "intro" | "chapter" | "outro";

export interface SceneEntry {
  key: string;
  kind: EntryKind;
  /** scene type, or "intro" | "chapter" | "outro" */
  type: string;
  spec?: SceneSpec;
  chapterIndex: number;
  chapterTitle: string;
  voice?: string;
  transition: TransitionName;
  hold?: number;
}

export function buildEntries(script: LessonScript, format: FormatName): SceneEntry[] {
  const out: SceneEntry[] = [];
  const multi = script.chapters.length > 1;
  const introMode = script.intro === "auto" ? (format === "landscape" ? "after-first" : "none") : script.intro;
  let n = 0;

  const pushIntro = () =>
    out.push({ key: "intro", kind: "intro", type: "intro", chapterIndex: 0, chapterTitle: script.chapters[0].title, transition: "auto" });

  if (introMode === "start") pushIntro();

  script.chapters.forEach((ch, ci) => {
    const showCard = ch.card ?? multi;
    ch.scenes.forEach((s, si) => {
      const isVeryFirst = ci === 0 && si === 0;
      // chapter card: before the chapter's first scene — except the cold open
      // (the lesson's first scene), which always plays first; chapter 1's card
      // then follows it (and the intro sting, when there is one).
      const cardBefore = ci === 0 && introMode !== "start" ? 1 : 0;
      if (si === cardBefore && showCard) {
        out.push({
          key: `chapter-${ci + 1}`,
          kind: "chapter",
          type: "chapter",
          chapterIndex: ci,
          chapterTitle: ch.title,
          voice: ch.voice,
          transition: "auto",
        });
      }
      n++;
      out.push({
        key: s.id ?? `s${n}`,
        kind: "scene",
        type: s.type,
        spec: s,
        chapterIndex: ci,
        chapterTitle: ch.title,
        voice: s.voice,
        transition: s.transition ?? "auto",
        hold: s.hold,
      });
      if (isVeryFirst && introMode === "after-first") pushIntro();
    });
  });

  if (script.outro.enabled) {
    out.push({
      key: "outro",
      kind: "outro",
      type: "outro",
      chapterIndex: script.chapters.length - 1,
      chapterTitle: script.chapters[script.chapters.length - 1].title,
      voice: script.outro.voice,
      transition: "auto",
    });
  }
  return out;
}

// ── voice preparation ────────────────────────────────────────────────────

export interface PreparedSegment {
  /** clean display text (markers removed) */
  text: string;
  /** text sent to TTS (lexicon applied) */
  spoken: string;
  cues: { name: string; offset: number }[];
  pauseAfter: number;
  mapOffset(offset: number): number;
}

export interface PreparedVoice {
  parsed: ParsedVoice;
  segments: PreparedSegment[];
}

export function prepareVoice(raw: string | undefined, lexicon: Lexicon | null): PreparedVoice | null {
  if (!raw || !raw.trim()) return null;
  const parsed = parseVoice(raw);
  return {
    parsed,
    segments: parsed.segments.map((seg) => {
      const lex = applyLexicon(seg.text, lexicon);
      return { text: seg.text, spoken: lex.text, cues: seg.cues, pauseAfter: seg.pauseAfter, mapOffset: lex.mapOffset };
    }),
  };
}

// ── timeline ─────────────────────────────────────────────────────────────

export interface SegmentAudio {
  path: string | null;
  duration: number;
  words: WordTiming[];
}

export interface PlannedBeat {
  t: number;
  do: string;
  target?: string | number | (string | number)[];
  lines?: number[];
  path?: string[];
  note?: string;
  sfx?: string | false;
  /** index into the scene's notes (code/diagram annotations) */
  noteId?: number;
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface PlannedScene {
  key: string;
  kind: EntryKind;
  type: string;
  spec?: SceneSpec;
  chapterIndex: number;
  chapterTitle: string;
  /** transition into this scene starts */
  start: number;
  /** transition done, scene fully in */
  enterAt: number;
  voiceStart: number;
  voiceEnd: number;
  /** next transition starts (scene content still visible until `until`) */
  end: number;
  until: number;
  transition: { type: Exclude<TransitionName, "auto">; dur: number };
  beats: PlannedBeat[];
  cues: Record<string, number>;
  pauses: { start: number; end: number }[];
  segments: { path: string | null; start: number; duration: number }[];
  words: CaptionWord[];
  /** clean narration for script.txt */
  text: string;
}

export interface LessonTimeline {
  duration: number;
  scenes: PlannedScene[];
  chapters: { index: number; title: string; start: number }[];
}

const TRANSITION_DUR: Record<string, number> = {
  none: 0, fade: 0.5, push: 0.6, "slide-up": 0.6, zoom: 0.6, wipe: 0.75, iris: 0.65, blinds: 0.8, blur: 0.6, glitch: 0.45,
};

const MIN_SCENE: Record<string, number> = {
  intro: 3.0, chapter: 2.3, outro: 6.5, title: 2.6, statement: 2.2, quiz: 3.5,
  // pattern interrupts are short on purpose (≤ 1.5 s of narration)
  "energy.punch": 1.2, "energy.punch-3d": 1.4,
};

/** Energy scenes play one impact hit; this is when (seconds after enterAt). */
const IMPACT_AT: Record<string, number> = {
  "energy.punch": 0.12, "energy.punch-3d": 0.12, "energy.big-rank": 0.1, "energy.myth-fact": -1, "energy.before-after": -1,
};

function resolveTransition(entry: SceneEntry, prev: SceneEntry | undefined, style: StylePack, sceneIdx: number): Exclude<TransitionName, "auto"> {
  if (!prev) return "none";
  if (entry.transition !== "auto") return entry.transition as Exclude<TransitionName, "auto">;
  const t = style.transitions;
  if (entry.kind === "intro") return t.intro as Exclude<TransitionName, "auto">;
  if (entry.kind === "chapter") return t.chapter as Exclude<TransitionName, "auto">;
  if (entry.kind === "outro") return t.outro as Exclude<TransitionName, "auto">;
  if (prev.kind === "chapter" || prev.kind === "intro") return t.afterChapter as Exclude<TransitionName, "auto">;
  if (entry.type === "quiz") return t.quiz as Exclude<TransitionName, "auto">;
  return (sceneIdx % 3 === 2 ? t.secondary : t.primary) as Exclude<TransitionName, "auto">;
}

/** Tokenize display text into words with character offsets. */
function displayWords(text: string): { text: string; start: number; end: number }[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}

export function buildTimeline(
  entries: SceneEntry[],
  voice: Map<string, { prepared: PreparedVoice; audio: SegmentAudio[] } | null>,
  style: StylePack,
  format: FormatName,
): LessonTimeline {
  const scenes: PlannedScene[] = [];
  let t = 0;
  let contentIdx = 0;

  entries.forEach((entry, i) => {
    const prev = entries[i - 1];
    const type = resolveTransition(entry, prev, style, contentIdx);
    if (entry.kind === "scene") contentIdx++;
    const dur = TRANSITION_DUR[type] ?? 0.5;
    const start = t;
    const enterAt = start + dur;
    const preRoll = i === 0 ? 0.35 : style.timing.preRoll;
    const voiceStart = enterAt + preRoll;

    const v = voice.get(entry.key) ?? null;
    const cues: Record<string, number> = {};
    const pauses: { start: number; end: number }[] = [];
    const segments: PlannedScene["segments"] = [];
    const words: CaptionWord[] = [];
    let cursor = voiceStart;

    if (v) {
      v.prepared.segments.forEach((seg, si) => {
        const audio = v.audio[si];
        const segStart = cursor;
        const segDur = audio ? audio.duration : 0;
        if (audio && audio.path) segments.push({ path: audio.path, start: segStart, duration: segDur });
        const aligned: AlignedWord[] = audio ? alignWords(seg.spoken, audio.words) : [];
        for (const c of seg.cues) {
          cues[c.name] = segStart + (seg.text ? timeAtOffset(aligned, seg.mapOffset(c.offset), segDur) : 0);
        }
        // caption words in display form, timed through the lexicon offset map
        const dw = displayWords(seg.text);
        dw.forEach((w, wi) => {
          const ws = segStart + timeAtOffset(aligned, seg.mapOffset(w.start), segDur);
          const next = dw[wi + 1];
          const we = next ? segStart + timeAtOffset(aligned, seg.mapOffset(next.start), segDur) : segStart + segDur;
          words.push({ text: w.text, start: ws, end: Math.max(we, ws + 0.05) });
        });
        cursor = segStart + segDur;
        if (seg.pauseAfter > 0) {
          pauses.push({ start: cursor, end: cursor + seg.pauseAfter });
          cursor += seg.pauseAfter;
        }
      });
    }
    const voiceEnd = cursor;
    const hold = entry.hold ?? style.timing.hold;
    const minDur = MIN_SCENE[entry.type] ?? 2.0;
    const minOutro = entry.kind === "outro" && format === "portrait" ? 4.2 : minDur;
    const end = Math.max(voiceEnd + hold, enterAt + (entry.kind === "outro" ? minOutro : minDur));

    const spec = entry.spec;
    const beats = spec ? planBeats(spec, cues, voiceStart, voiceEnd, enterAt) : [];

    scenes.push({
      key: entry.key,
      kind: entry.kind,
      type: entry.type,
      spec,
      chapterIndex: entry.chapterIndex,
      chapterTitle: entry.chapterTitle,
      start,
      enterAt,
      voiceStart,
      voiceEnd,
      end,
      until: end,
      transition: { type, dur },
      beats,
      cues,
      pauses,
      segments,
      words,
      text: v ? v.prepared.parsed.display : "",
    });
    t = end;
  });

  // each scene stays visible until the next scene's transition finishes
  scenes.forEach((s, i) => {
    const next = scenes[i + 1];
    s.until = next ? next.enterAt : s.end + 0.25;
  });
  const duration = scenes.length ? scenes[scenes.length - 1].until : 0;

  const chapters: LessonTimeline["chapters"] = [];
  for (const s of scenes) {
    if (!chapters.some((c) => c.index === s.chapterIndex)) {
      chapters.push({ index: s.chapterIndex, title: s.chapterTitle, start: s.start });
    }
  }
  return { duration, scenes, chapters };
}

/** "{cache}" and "cache" both name the cue {cache}. */
const cueKey = (a: string) => a.trim().replace(/^\{\s*/, "").replace(/\s*\}$/, "");

/** Turn cues + explicit beats into absolute-time beats for one scene. */
function planBeats(
  spec: SceneSpec,
  cues: Record<string, number>,
  voiceStart: number,
  voiceEnd: number,
  enterAt: number,
): PlannedBeat[] {
  const beats: PlannedBeat[] = [];
  const at = (a: string | number): number | null => {
    if (typeof a === "number") return voiceStart + a;
    if (a === "start") return enterAt;
    if (a === "end") return voiceEnd;
    return cues[cueKey(a)] ?? null;
  };

  // implicit beats from marker names
  for (const [name, time] of Object.entries(cues)) {
    const action: CueAction = interpretCue(name);
    switch (action.kind) {
      case "item":
        beats.push({ t: time, do: "reveal", target: action.index });
        break;
      case "lines":
        beats.push({ t: time, do: "focus", lines: action.lines });
        break;
      case "answer":
        beats.push({ t: time, do: "answer" });
        break;
      case "action": {
        const verb = action.verb === "hl" ? "highlight" : action.verb;
        if (verb === "flow") beats.push({ t: time, do: "flow", path: action.arg.split(">").map((x) => x.trim()).filter(Boolean) });
        else beats.push({ t: time, do: verb, target: /^\d+$/.test(action.arg) ? Number(action.arg) : action.arg });
        break;
      }
      case "named":
        break;
    }
  }

  // explicit beats
  for (const b of spec.beats ?? []) {
    const time = at(b.at);
    if (time === null) continue; // unknown cue name — validated/warned by the pipeline
    beats.push({
      t: time,
      do: b.do,
      target: b.target,
      lines: b.lines ? parseLineSpec(b.lines) : undefined,
      path: b.path,
      note: b.note,
      sfx: b.sfx,
    });
  }

  beats.sort((a, b) => a.t - b.t);
  let noteId = 0;
  for (const b of beats) if (b.note) b.noteId = noteId++;
  return beats;
}

/** Cue names used in `beats[].at` that do not exist in the narration. */
export function unknownBeatCues(spec: SceneSpec, cues: Record<string, number>): string[] {
  return (spec.beats ?? [])
    .map((b) => b.at)
    .filter((a): a is string => typeof a === "string" && a !== "start" && a !== "end" && !(cueKey(a) in cues))
    .map(cueKey);
}

// ── sound events ─────────────────────────────────────────────────────────

export interface SfxEvent {
  t: number;
  event: string;
  /** explicit sound name (overrides the style preference list) */
  name?: string;
  volume?: number;
  seed: string;
}

/** When the runtime starts a scene's entrance (mirrors lesson-runtime.js). */
export function entranceAt(s: PlannedScene, index: number, beat = false): number {
  if (index === 0 && beat && (s.type === "title" || s.type === "3d.hero-object")) return 0;
  return index === 0 ? 0.15 : s.enterAt - Math.min(0.22, s.transition.dur * 0.4);
}

export function buildSfxEvents(timeline: LessonTimeline, style?: Pick<StylePack, "motion">): SfxEvent[] {
  const ev: SfxEvent[] = [];
  timeline.scenes.forEach((s, index) => {
    const t0 = entranceAt(s, index, style?.motion.hook === "beat");
    // hook beat: whoosh with the accent flash, pop on the first word, ding on the keyword sweep
    if (style?.motion.hook === "beat" && (s.type === "title" || s.type === "3d.hero-object")) {
      if (index === 0) ev.push({ t: t0, event: "transition", seed: `${s.key}:beat` });
      ev.push({ t: t0 + 0.18, event: "reveal", seed: `${s.key}:pop` });
      if ((s.spec as { keyword?: string } | undefined)?.keyword) ev.push({ t: t0 + 0.75, event: "highlight", seed: `${s.key}:kw` });
    }
    const impact = IMPACT_AT[s.type];
    if (impact !== undefined) {
      // myth-fact hits on the strike, before-after on the badge (both at the fact/after cue)
      const at = impact >= 0 ? s.enterAt + impact : (s.cues.fact ?? s.cues.after ?? s.voiceStart + (s.voiceEnd - s.voiceStart) * 0.45);
      ev.push({ t: at, event: "impact", seed: `${s.key}:impact` });
    }
    sceneSfx(s, ev);
  });
  return thin(ev);
}

function sceneSfx(s: PlannedScene, ev: SfxEvent[]) {
  if (s.transition.type !== "none") ev.push({ t: s.start + 0.02, event: "transition", seed: `${s.key}:tr` });
  if (s.kind === "intro") ev.push({ t: s.start + 0.15, event: "intro", seed: s.key });
  if (s.kind === "chapter") ev.push({ t: s.enterAt, event: "chapter", seed: s.key });
  if (s.kind === "outro") ev.push({ t: s.enterAt + 0.2, event: "outro", seed: s.key });

  const spec = s.spec;
  for (const b of s.beats) {
    if (b.sfx === false) continue;
    const event =
      b.do === "answer" ? "correct"
      : b.do === "flow" ? "flow"
      : b.do === "tap" ? "tap"
      : b.do === "type" ? "type"
      : b.do === "focus" ? "focus"
      : b.do === "highlight" ? "highlight"
      : "reveal";
    ev.push({ t: b.t, event, name: typeof b.sfx === "string" ? b.sfx : undefined, seed: `${s.key}:${b.t.toFixed(2)}` });
  }
  if (spec?.type === "quiz") {
    const countdown = s.pauses.find((p) => p.end - p.start >= 1.5);
    if (countdown) {
      ev.push({ t: countdown.start, event: "countdown", seed: `${s.key}:cd` });
      if (!s.beats.some((b) => b.do === "answer")) ev.push({ t: countdown.end, event: "correct", seed: `${s.key}:ans` });
    }
  }
  if ((spec?.type === "code" && spec.typing !== false) || spec?.type === "terminal") {
    ev.push({ t: s.enterAt + 0.1, event: "type", seed: `${s.key}:type` });
  }
  for (const x of spec?.sfx ?? []) {
    const time =
      typeof x.at === "number" ? s.voiceStart + x.at
      : x.at === "start" ? s.enterAt
      : x.at === "end" ? s.voiceEnd
      : s.cues[cueKey(x.at)];
    if (time !== undefined) ev.push({ t: time, event: "custom", name: x.name, volume: x.volume, seed: `${s.key}:${x.name}` });
  }
}

function thin(ev: SfxEvent[]): SfxEvent[] {
  ev.sort((a, b) => a.t - b.t);

  // thin out crowded events: same event type within 0.3s, anything within 0.12s
  const kept: SfxEvent[] = [];
  for (const e of ev) {
    const clash = kept.some(
      (k) => Math.abs(k.t - e.t) < 0.12 || (k.event === e.event && e.event !== "custom" && Math.abs(k.t - e.t) < 0.3),
    );
    if (!clash || e.name) kept.push(e);
  }
  return kept;
}

// ── captions ─────────────────────────────────────────────────────────────

export interface CaptionGroup {
  /** key of the scene the words belong to */
  scene: string;
  start: number;
  end: number;
  words: CaptionWord[];
}

export function buildCaptionGroups(timeline: LessonTimeline, maxWords: number): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  for (const s of timeline.scenes) {
    let cur: CaptionWord[] = [];
    const flush = () => {
      if (cur.length) groups.push({ scene: s.key, start: cur[0].start, end: cur[cur.length - 1].end + 0.12, words: cur });
      cur = [];
    };
    s.words.forEach((w, i) => {
      const prev = s.words[i - 1];
      if (prev && w.start - prev.end > 0.6) flush(); // pause → new line
      cur.push(w);
      if (cur.length >= maxWords || /[.,!?;:…]$/.test(w.text)) flush();
    });
    flush();
  }
  // never overlap: a group ends when the next one starts
  groups.forEach((g, i) => {
    const next = groups[i + 1];
    if (next && g.end > next.start) g.end = next.start;
  });
  return groups;
}
