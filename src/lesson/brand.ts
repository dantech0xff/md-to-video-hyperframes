/** Brand kit loader — <id>/brand.json + logo files, from BRANDS_DIR first, then assets/brand. */
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

/** Where brand kits live: `BRANDS_DIR` (the user's own kits, e.g. in the desktop app's data folder), then the bundled ones. */
export function brandRoots(): string[] {
  return [process.env.BRANDS_DIR, join(ASSETS_DIR, "brand")].filter((d): d is string => !!d);
}

export function loadBrand(id: string): BrandKit {
  const name = BRAND_ALIASES[id] ?? id;
  // an id is a folder name, never a path
  if (!/^[\w-]+$/.test(name)) throw new Error(`Invalid brand id "${id}": use letters, digits, "-" or "_"`);
  const dir = brandRoots().map((root) => join(root, name)).find((d) => existsSync(join(d, "brand.json")));
  if (!dir) throw new Error(`Brand kit not found: ${name} (looked in ${brandRoots().join(", ")})`);
  const raw = JSON.parse(readFileSync(join(dir, "brand.json"), "utf8")) as Omit<BrandKit, "dir">;
  return { ...raw, dir };
}

/** Ids of every available brand kit; a kit in BRANDS_DIR hides a bundled one with the same id. */
export function listBrands(): string[] {
  const ids = new Set<string>();
  for (const root of brandRoots()) {
    if (!existsSync(root)) continue;
    for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && existsSync(join(root, e.name, "brand.json"))) ids.add(e.name);
  }
  return [...ids];
}
