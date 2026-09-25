/**
 * Style packs — src/lesson/styles/<id>/{style.json, style.css}.
 * A style = design tokens (CSS) + motion profile + transition set +
 * code theme + SFX/music name preferences. Templates only use CSS variables,
 * so the same lesson renders with a completely different personality.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TransitionName } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STYLES_DIR = join(__dirname, "styles");

export interface MotionProfile {
  enter: string;
  emphasis: string;
  move: string;
  soft: string;
  exit: string;
  fast: number;
  base: number;
  slow: number;
  stagger: number;
  distance: number;
  /** how headline text arrives: rise (per word), write (left→right wipe), scramble, fade */
  text: "rise" | "write" | "scramble" | "fade";
  /** "beat": hook scenes use the energy beat (accent flash, first-word pop, keyword sweep, slow zoom) */
  hook?: "beat";
}

export interface StylePack {
  id: string;
  name: string;
  theme: "dark" | "light";
  fonts: { display: string; body: string; mono: string };
  codeTheme: string;
  motion: MotionProfile;
  timing: { preRoll: number; hold: number };
  transitions: {
    primary: TransitionName;
    secondary: TransitionName;
    chapter: TransitionName;
    afterChapter: TransitionName;
    intro: TransitionName;
    outro: TransitionName;
    quiz: TransitionName;
  };
  sfx: Record<string, string[]>;
  sfxVolume: Record<string, number>;
  music: string[];
  musicVolume: number;
  css: string;
}

export function listStyles(): string[] {
  return readdirSync(STYLES_DIR).filter((d) => existsSync(join(STYLES_DIR, d, "style.json")));
}

/**
 * A style.json may `"extends": "<parent id>"`: the parent's settings are the
 * defaults (objects merged one level deep) and its CSS is reused with the
 * `[data-style="<parent>"]` selectors retargeted, before the style's own CSS.
 */
export function loadStyle(id: string): StylePack {
  const dir = join(STYLES_DIR, id);
  const jsonPath = join(dir, "style.json");
  if (!existsSync(jsonPath)) {
    throw new Error(`Unknown style "${id}". Available: ${listStyles().join(", ")}`);
  }
  const json = JSON.parse(readFileSync(jsonPath, "utf8")) as Omit<StylePack, "css"> & { extends?: string };
  const cssPath = join(dir, "style.css");
  const own = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  if (!json.extends) return { ...json, css: own };
  const parent = loadStyle(json.extends);
  const merged: Record<string, unknown> = { ...parent };
  for (const [k, v] of Object.entries(json)) {
    const pv = (parent as unknown as Record<string, unknown>)[k];
    merged[k] = v && typeof v === "object" && !Array.isArray(v) && pv && typeof pv === "object" && !Array.isArray(pv) ? { ...pv, ...v } : v;
  }
  delete merged.extends;
  const inherited = parent.css.split(`[data-style="${parent.id}"]`).join(`[data-style="${id}"]`);
  return { ...(merged as unknown as StylePack), id, css: `${inherited}\n\n/* ── ${id} ── */\n${own}` };
}
