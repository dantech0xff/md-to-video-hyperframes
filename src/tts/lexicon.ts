/**
 * Pronunciation lexicon — rewrites tech terms into something a Vietnamese TTS
 * voice reads correctly ("API" → "ây pi ai"), while keeping a character-offset
 * map so cue markers placed in the original text still land on the right word.
 *
 * Lexicons live in assets/lexicon/<id>.json as { "Term": "cách đọc" }.
 * Matching is case-sensitive and bounded by non-letter/digit characters, so
 * "UI" does not fire inside "UIKit" and "Go" does not fire inside "Google".
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lookInside } from "../utils/inside.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LEXICON_DIR = join(__dirname, "..", "..", "assets", "lexicon");

export type Lexicon = Record<string, string>;

export interface LexiconResult {
  text: string;
  /** map an offset in the source text to the matching offset in `text` */
  mapOffset(offset: number): number;
  replacements: number;
}

interface Span {
  srcStart: number;
  srcEnd: number;
  dstStart: number;
  dstEnd: number;
  replaced: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function applyLexicon(text: string, lexicon: Lexicon | null | undefined): LexiconResult {
  const keys = Object.keys(lexicon ?? {})
    .filter((k) => !k.startsWith("//") && k.trim() !== "")
    .sort((a, b) => b.length - a.length);
  if (!lexicon || keys.length === 0) {
    return { text, mapOffset: (o) => Math.min(Math.max(o, 0), text.length), replacements: 0 };
  }

  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${keys.map(escapeRe).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const spans: Span[] = [];
  let out = "";
  let last = 0;
  let replacements = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index!;
    if (i > last) {
      spans.push({ srcStart: last, srcEnd: i, dstStart: out.length, dstEnd: out.length + (i - last), replaced: false });
      out += text.slice(last, i);
    }
    const repl = lexicon[m[0]];
    spans.push({ srcStart: i, srcEnd: i + m[0].length, dstStart: out.length, dstEnd: out.length + repl.length, replaced: true });
    out += repl;
    last = i + m[0].length;
    replacements++;
  }
  if (last < text.length) {
    spans.push({ srcStart: last, srcEnd: text.length, dstStart: out.length, dstEnd: out.length + (text.length - last), replaced: false });
    out += text.slice(last);
  }

  const mapOffset = (offset: number): number => {
    if (offset <= 0) return 0;
    if (offset >= text.length) return out.length;
    for (const s of spans) {
      if (offset < s.srcEnd || (offset === s.srcEnd && s === spans[spans.length - 1])) {
        if (offset < s.srcStart) continue;
        return s.replaced ? s.dstStart : s.dstStart + (offset - s.srcStart);
      }
    }
    return out.length;
  };

  return { text: out, mapOffset, replacements };
}

const cache = new Map<string, Lexicon>();

/**
 * `id` names a lexicon shipped in `dir` itself: a plain id whose file is
 * there, not a link from there to a file elsewhere. The only kind an agent's
 * script may use (LessonRunOptions.assetRoot).
 */
export function isBundledLexicon(id: string, dir = LEXICON_DIR): boolean {
  if (!/^[\w-]+$/.test(id)) return false;
  // a link there is followed only when it stays in `dir`, one to elsewhere is never looked up
  return !!lookInside(dir, join(dir, `${id}.json`))?.st.isFile();
}

/** Load assets/lexicon/<id>.json (or an absolute/relative path to a .json file). */
export function loadLexicon(idOrPath: string): Lexicon {
  const path = idOrPath.endsWith(".json") ? idOrPath : join(LEXICON_DIR, `${idOrPath}.json`);
  const hit = cache.get(path);
  if (hit) return hit;
  if (!existsSync(path)) throw new Error(`Lexicon not found: ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const lex: Lexicon = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("//") || typeof v !== "string") continue;
    lex[k] = v;
  }
  cache.set(path, lex);
  return lex;
}
