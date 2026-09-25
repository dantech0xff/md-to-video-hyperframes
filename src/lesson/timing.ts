/**
 * Word timing utilities — turn whatever timing data a TTS provider gives us
 * (Edge word boundaries, ElevenLabs character alignment, SRT cues, or
 * nothing at all) into per-word timings aligned to character offsets of the
 * spoken text. Cue markers become timestamps through timeAtOffset().
 */

export interface WordTiming {
  text: string;
  /** seconds from the start of the segment audio */
  start: number;
  end: number;
}

export interface AlignedWord extends WordTiming {
  /** character range of this word in the spoken text (-1 when unmatched) */
  charStart: number;
  charEnd: number;
}

const norm = (s: string) => s.normalize("NFC").toLowerCase();
const WORD_CHARS = /[\p{L}\p{N}]+/gu;

/** Strip punctuation around a token so "gì?" matches "gì". */
function core(token: string): string {
  const parts = norm(token).match(WORD_CHARS);
  return parts ? parts.join("") : "";
}

/**
 * Locate each timed word in `text` (sequential search from a moving cursor).
 * Words that cannot be found keep charStart = -1 and are interpolated later.
 */
export function alignWords(text: string, words: WordTiming[]): AlignedWord[] {
  const hay = norm(text);
  const re = new RegExp(WORD_CHARS.source, "gu");
  let cursor = 0;
  return words.map((w) => {
    const needle = core(w.text);
    if (!needle) return { ...w, charStart: -1, charEnd: -1 };
    // tokens in the text around the cursor: compare word-by-word, not substring,
    // so "an" does not match inside "ban"
    re.lastIndex = cursor;
    let found: { start: number; end: number } | null = null;
    let tries = 0;
    let m: RegExpExecArray | null;
    let joined = "";
    let joinStart = -1;
    while ((m = re.exec(hay)) && tries < 12) {
      tries++;
      if (m[0] === needle) {
        found = { start: m.index, end: m.index + m[0].length };
        break;
      }
      // multi-token words (e.g. "Node.js" → "node" + "js") — accumulate
      if (needle.startsWith(joined + m[0])) {
        if (joinStart < 0) joinStart = m.index;
        joined += m[0];
        if (joined === needle) {
          found = { start: joinStart, end: m.index + m[0].length };
          break;
        }
      } else {
        joined = "";
        joinStart = -1;
        if (needle.startsWith(m[0])) {
          joinStart = m.index;
          joined = m[0];
        }
      }
    }
    if (!found) return { ...w, charStart: -1, charEnd: -1 };
    cursor = found.end;
    return { ...w, charStart: found.start, charEnd: found.end };
  });
}

/**
 * Time (seconds from segment start) at which the narration reaches `offset`:
 * the start of the first word whose text begins at/after the offset.
 */
export function timeAtOffset(aligned: AlignedWord[], offset: number, duration: number): number {
  if (aligned.length === 0) return 0;
  const matched = aligned.filter((w) => w.charStart >= 0);
  if (matched.length === 0) {
    // nothing aligned — fall back to proportional position over word list
    return 0;
  }
  const hit = matched.find((w) => w.charEnd > offset);
  if (!hit) return Math.min(matched[matched.length - 1].end, duration);
  return Math.max(0, Math.min(hit.start, duration));
}

/** Rough timings when the provider returns none: syllable-weighted, with pauses at punctuation. */
export function estimateWordTimings(text: string, duration: number, leadIn = 0.08): WordTiming[] {
  const tokens = [...text.matchAll(/\S+/g)].map((m) => m[0]);
  if (tokens.length === 0) return [];
  const weights = tokens.map((t) => {
    const letters = core(t).length || 1;
    const punct = /[.!?…]$/.test(t) ? 3.5 : /[,;:]$/.test(t) ? 1.8 : 0;
    return { speak: 1.2 + letters * 0.35, gap: punct };
  });
  const total = weights.reduce((s, w) => s + w.speak + w.gap, 0);
  const usable = Math.max(duration - leadIn - 0.05, 0.1);
  let t = leadIn;
  return tokens.map((tok, i) => {
    const speak = (weights[i].speak / total) * usable;
    const gap = (weights[i].gap / total) * usable;
    const w = { text: tok, start: t, end: t + speak };
    t += speak + gap;
    return w;
  });
}

const srtTime = (s: string) => {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0").slice(0, 3)) / 1000;
};

/** Parse SRT; multi-word cues are split into words with time spread by length. */
export function srtToWordTimings(srt: string): WordTiming[] {
  const out: WordTiming[] = [];
  for (const block of srt.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [a, b] = timeLine.split("-->");
    const start = srtTime(a);
    const end = srtTime(b);
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const lens = words.map((w) => Math.max(core(w).length, 1));
    const sum = lens.reduce((x, y) => x + y, 0);
    let t = start;
    words.forEach((w, i) => {
      const d = ((end - start) * lens[i]) / sum;
      out.push({ text: w, start: t, end: t + d });
      t += d;
    });
  }
  return out;
}

/** ElevenLabs `with-timestamps` character alignment → word timings. */
export function charAlignmentToWords(chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let cur: WordTiming | null = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { text: ch, start: starts[i] ?? 0, end: ends[i] ?? starts[i] ?? 0 };
    else {
      cur.text += ch;
      cur.end = ends[i] ?? cur.end;
    }
  }
  if (cur) words.push(cur);
  return words;
}

/** Edge TTS WordBoundary (100-ns units) → seconds. */
export function edgeBoundariesToWords(bounds: { offset: number; duration: number; text: string }[]): WordTiming[] {
  return bounds.map((b) => ({ text: b.text, start: b.offset / 1e7, end: (b.offset + b.duration) / 1e7 }));
}
