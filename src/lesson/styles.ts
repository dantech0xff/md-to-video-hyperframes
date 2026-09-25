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

export function loadStyle(id: string): StylePack {
  const dir = join(STYLES_DIR, id);
  const jsonPath = join(dir, "style.json");
  if (!existsSync(jsonPath)) {
    throw new Error(`Unknown style "${id}". Available: ${listStyles().join(", ")}`);
  }
  const json = JSON.parse(readFileSync(jsonPath, "utf8")) as Omit<StylePack, "css">;
  const css = readFileSync(join(dir, "style.css"), "utf8");
  return { ...json, css };
}
