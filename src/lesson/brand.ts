/** Brand kit loader — assets/brand/<id>/brand.json + logo files. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ASSETS_DIR } from "./sound-library.js";

export interface BrandKit {
  id: string;
  dir: string;
  name: string;
  shortName: string;
  website: string;
  tagline: string;
  handle: string;
  socials: Record<string, string>;
  logo: { onDark: string; onLight: string; square: string };
  /**
   * Text wordmark set in the display font, e.g. [{ text: "Dan" }, { text: "Tech", color: "#47c038" }].
   * When present it replaces the PNG logo in videos. Parts without `color` use the scene ink.
   */
  wordmark?: { text: string; color?: string }[];
  colors: Record<string, string>;
  fonts: { sans: string; mono: string };
  cta: {
    landscape: { title: string; subtitle: string };
    portrait: { title: string; subtitle: string };
  };
  defaultStyle: string;
  /**
   * Mascot / avatar: the built-in SVG robot, or your own PNGs per pose
   * (`idle` required; missing poses fall back to it).
   */
  mascot?:
    | { name: string; kind: "builtin" }
    | { name: string; kind: "image"; poses: { idle: string } & Partial<Record<"wave" | "point" | "think" | "celebrate", string>> };
}

/** Old brand ids still accepted in scripts. */
const BRAND_ALIASES: Record<string, string> = { "dan-tech-academy": "dan-tech" };

export function loadBrand(id: string): BrandKit {
  const dir = join(ASSETS_DIR, "brand", BRAND_ALIASES[id] ?? id);
  const file = join(dir, "brand.json");
  if (!existsSync(file)) throw new Error(`Brand kit not found: ${file}`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as Omit<BrandKit, "dir">;
  return { ...raw, dir };
}
