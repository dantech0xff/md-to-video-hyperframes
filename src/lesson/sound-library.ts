/**
 * Name-based sound library — SFX in assets/sfx, background music in
 * assets/music. Files are identified by their names: drop in
 * `whoosh-soft.mp3`, `pop-bubble.wav`, `lofi-chill-coding.mp3`… and scripts
 * (or style defaults) refer to them by name or by words in the name.
 *
 * Resolution order for a query like "whoosh" or "transition/whoosh-soft":
 *   1. exact relative path / name (without extension)
 *   2. exact file basename
 *   3. every query word appears in the name → deterministic pick among matches
 *   4. best partial word overlap → deterministic pick among the best
 *
 * Files under a `_starter/` folder (placeholders from `npm run sounds:starter`)
 * are only used when nothing in your own library matches.
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDurationSec } from "../assets/audio-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = join(__dirname, "..", "..", "assets");
/** Library folders — override with SFX_DIR / MUSIC_DIR (e.g. a shared library outside the repo). */
export const sfxDir = () => process.env.SFX_DIR || join(ASSETS_DIR, "sfx");
export const musicDir = () => process.env.MUSIC_DIR || join(ASSETS_DIR, "music");

const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);

export interface SoundItem {
  /** relative path without extension, "/" separated — the canonical name */
  name: string;
  /** file basename without extension */
  base: string;
  file: string;
  tokens: string[];
}

/** lowercase, strip Vietnamese diacritics, split into words */
export function tokenize(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function scanSounds(dir: string): SoundItem[] {
  if (!existsSync(dir)) return [];
  const out: SoundItem[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      if (entry.startsWith(".")) continue;
      const p = join(d, entry);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (AUDIO_EXT.has(extname(entry).toLowerCase())) {
        const rel = relative(dir, p).split("\\").join("/");
        const name = rel.slice(0, -extname(rel).length);
        const base = name.split("/").pop()!;
        out.push({ name, base, file: p, tokens: tokenize(name) });
      }
    }
  };
  walk(dir);
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = <T>(arr: T[], seed: string): T => arr[hash(seed) % arr.length];

const isStarter = (i: SoundItem) => i.name.startsWith("_starter/");

/** Your own files first, `_starter/` placeholders second. */
function pools(items: SoundItem[]): SoundItem[][] {
  const own = items.filter((i) => !isStarter(i));
  const starter = items.filter(isStarter);
  return [own, starter].filter((p) => p.length > 0);
}

/** Stages 1–3 (exact / basename / all words); stage 4 (best partial overlap) only when `partial`. */
function matchSound(q: string, items: SoundItem[], seed: string, partial: boolean): SoundItem | null {
  const matches = matchAll(q, items, partial);
  return matches.length ? pick(matches, seed) : null;
}

/** The sounds the first stage that matches `q` offers (matchSound picks one of them by seed). */
function matchAll(q: string, items: SoundItem[], partial: boolean): SoundItem[] {
  const exact = items.find((i) => i.name.toLowerCase() === q);
  if (exact) return [exact];
  const byBase = items.filter((i) => i.base.toLowerCase() === q);
  if (byBase.length > 0) return byBase;

  const qt = tokenize(q);
  if (qt.length === 0) return [];
  const all = items.filter((i) => qt.every((t) => i.tokens.includes(t)));
  if (all.length > 0) return all;
  if (!partial) return [];

  let best = 0;
  let bestItems: SoundItem[] = [];
  for (const i of items) {
    const score = qt.filter((t) => i.tokens.includes(t)).length;
    if (score > best) {
      best = score;
      bestItems = [i];
    } else if (score === best && score > 0) bestItems.push(i);
  }
  return best > 0 ? bestItems : [];
}

const normQuery = (query: string) =>
  query.trim().toLowerCase().replace(/\.(mp3|wav|ogg|m4a|aac|flac)$/, "");

export function resolveSound(query: string, items: SoundItem[], seed = query): SoundItem | null {
  const q = normQuery(query);
  if (!q) return null;
  for (const pool of pools(items)) {
    const hit = matchSound(q, pool, seed, true);
    if (hit) return hit;
  }
  return null;
}

/**
 * First query in `prefs` that resolves wins (style defaults: ["whoosh","swoosh",…]).
 * Every pref is tried strictly before any partial-word fallback, and your own
 * files before `_starter/` placeholders.
 */
export function resolveFirst(prefs: string[], items: SoundItem[], seed: string): SoundItem | null {
  const found = soundCandidates(prefs, items);
  return found ? pick(found.sounds, `${seed}|${found.pref}`) : null;
}

/**
 * The sounds `prefs` can play, as resolveFirst finds them: the query that
 * matched first and every sound it matches (each place it plays picks one of
 * them). Undefined when none matches.
 */
export function soundCandidates(prefs: string[], items: SoundItem[]): { pref: string; sounds: SoundItem[] } | undefined {
  for (const pool of pools(items)) {
    for (const partial of [false, true]) {
      for (const p of prefs) {
        const q = normQuery(p);
        const sounds = q ? matchAll(q, pool, partial) : [];
        if (sounds.length) return { pref: p, sounds };
      }
    }
  }
  return undefined;
}

export interface CatalogEntry {
  name: string;
  file: string;
  duration: number;
  tags: string[];
}

/** Write <dir>/catalog.json so the skill can pick sounds by name without listing files. */
export async function writeCatalog(dir: string): Promise<CatalogEntry[]> {
  const items = scanSounds(dir);
  const entries: CatalogEntry[] = [];
  for (const i of items) {
    let duration = 0;
    try {
      duration = Math.round((await getDurationSec(i.file)) * 100) / 100;
    } catch {
      /* unreadable file — keep 0 */
    }
    entries.push({ name: i.name, file: relative(dir, i.file).split("\\").join("/"), duration, tags: i.tokens });
  }
  await writeFile(join(dir, "catalog.json"), JSON.stringify({ generated: new Date().toISOString(), count: entries.length, sounds: entries }, null, 2));
  return entries;
}
