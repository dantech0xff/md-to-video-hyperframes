/** Brand kit loader — <id>/brand.json + logo files, from BRANDS_DIR first, then assets/brand. */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { ASSETS_DIR } from "./sound-library.js";

/** A file of the kit, by its path from the kit's folder ("logo.png", "mascot/idle.png"). */
const KitFile = z
  .string()
  .trim()
  .min(1)
  .refine((f) => !isAbsolute(f) && !/^[a-z]:/i.test(f) && !f.split(/[\\/]/).includes(".."), "a file in the brand kit's folder, such as logo.png");

const Hex = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "a colour such as #47c038");

const Cta = z.object({ title: z.string().max(80), subtitle: z.string().max(120) });

/**
 * brand.json. Only `name` is required: a kit without a logo shows its name as
 * a text wordmark, and the outro's call to action defaults to the name and
 * the website. `colors`, `fonts`, `socials` and `logo.square` are kept for
 * the brand's own use; videos take their colours and fonts from the style.
 */
export const BrandKitSchema = z.object({
  /** the folder's name is the kit's id; this one is ignored */
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  shortName: z.string().trim().max(40).optional(),
  website: z.string().trim().max(80).default(""),
  tagline: z.string().trim().max(120).default(""),
  handle: z.string().trim().max(60).default(""),
  socials: z.record(z.string(), z.string()).default({}),
  /** PNG logos: one for dark backgrounds, one for light ones (a style picks by its theme) */
  logo: z.object({ onDark: KitFile.optional(), onLight: KitFile.optional(), square: KitFile.optional() }).default({}),
  /**
   * Text wordmark set in the display font, e.g. [{ text: "Dan" }, { text: "Tech", color: "#47c038" }].
   * When present it replaces the PNG logo in videos. Parts without `color` use the scene ink.
   */
  wordmark: z
    .array(z.object({ text: z.string().trim().min(1).max(30), color: Hex.optional() }))
    .max(4)
    .optional(),
  colors: z.record(z.string(), z.string()).default({}),
  fonts: z.object({ sans: z.string(), mono: z.string() }).optional(),
  cta: z.object({ landscape: Cta, portrait: Cta }).optional(),
  /** the style a video of this brand uses when its script names none */
  defaultStyle: z.string().trim().min(1).default("dantech"),
  /**
   * Mascot / avatar: the built-in SVG robot, or your own PNGs per pose
   * (`idle` required; missing poses fall back to it).
   */
  mascot: z
    .discriminatedUnion("kind", [
      z.object({ name: z.string().trim().min(1).max(40), kind: z.literal("builtin") }),
      z.object({
        name: z.string().trim().min(1).max(40),
        kind: z.literal("image"),
        poses: z.object({ idle: KitFile, wave: KitFile.optional(), point: KitFile.optional(), think: KitFile.optional(), celebrate: KitFile.optional() }),
      }),
    ])
    .optional(),
});

export type BrandKitInput = z.input<typeof BrandKitSchema>;

export interface BrandKit extends Omit<z.output<typeof BrandKitSchema>, "id" | "shortName" | "cta"> {
  id: string;
  dir: string;
  shortName: string;
  cta: { landscape: { title: string; subtitle: string }; portrait: { title: string; subtitle: string } };
}

/** Old brand ids still accepted in scripts. */
const BRAND_ALIASES: Record<string, string> = { "dan-tech-academy": "dan-tech" };

/** Where brand kits live: `BRANDS_DIR` (the user's own kits, e.g. in the desktop app's data folder), then the bundled ones. */
export function brandRoots(): string[] {
  return [process.env.BRANDS_DIR, bundledBrandsDir()].filter((d): d is string => !!d);
}

/** The kits that ship with the engine. */
export function bundledBrandsDir(): string {
  return join(ASSETS_DIR, "brand");
}

/** A kit id: a folder name, never a path. */
export function isBrandId(id: string): boolean {
  return /^[\w-]+$/.test(id);
}

/** The folder of kit `id` (an alias resolved), or undefined when no root has it. */
export function brandDir(id: string): string | undefined {
  const name = BRAND_ALIASES[id] ?? id;
  if (!isBrandId(name)) return undefined;
  return brandRoots()
    .map((root) => join(root, name))
    .find((d) => existsSync(join(d, "brand.json")));
}

export function loadBrand(id: string): BrandKit {
  const name = BRAND_ALIASES[id] ?? id;
  // an id is a folder name, never a path
  if (!isBrandId(name)) throw new Error(`Invalid brand id "${id}": use letters, digits, "-" or "_"`);
  const dir = brandDir(name);
  if (!dir) throw new Error(`Brand kit not found: ${name} (looked in ${brandRoots().join(", ")})`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, "brand.json"), "utf8"));
  } catch (e) {
    throw new Error(`Brand kit ${name}: brand.json is not valid JSON (${(e as Error).message})`);
  }
  return parseBrandKit(raw, name, dir);
}

/** brand.json read as a kit, its defaults filled in; throws with what is wrong. */
export function parseBrandKit(raw: unknown, id: string, dir: string): BrandKit {
  const parsed = BrandKitSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "brand.json"}: ${i.message}`);
    throw new Error(`Brand kit ${id}: ${problems.join("; ")}`);
  }
  const kit = parsed.data;
  const cta = kit.cta ?? { landscape: { title: kit.name, subtitle: kit.website }, portrait: { title: kit.name, subtitle: kit.website } };
  return { ...kit, id, dir, shortName: kit.shortName || kit.name, cta };
}

/** Ids of every available brand kit; a kit in BRANDS_DIR hides a bundled one with the same id. */
export function listBrands(): string[] {
  const ids = new Set<string>();
  for (const root of brandRoots()) {
    if (!existsSync(root)) continue;
    for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && isBrandId(e.name) && existsSync(join(root, e.name, "brand.json"))) ids.add(e.name);
  }
  return [...ids];
}
