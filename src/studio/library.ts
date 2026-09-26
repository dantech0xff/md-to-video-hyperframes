/**
 * The user's library as the desktop app shows it: brand kits (BRANDS_DIR,
 * then the bundled ones) and sounds (SFX_DIR, MUSIC_DIR), with the sounds a
 * style plays for each of its events. Sounds are picked by their file names
 * (sound-library.ts), so the app shows which of the user's files each event
 * finds.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { BrandKitSchema, brandDir, bundledBrandsDir, isBrandId, listBrands } from "../lesson/brand.js";
import { musicDir, scanSounds, sfxDir, soundCandidates, type SoundItem } from "../lesson/sound-library.js";
import { listStyles, loadStyle } from "../lesson/styles.js";
import { lookInside } from "../utils/inside.js";

export interface BrandKitInfo {
  id: string;
  name: string;
  /** "user": the user's own kit (BRANDS_DIR), which the app edits; "bundled": shipped with the engine */
  source: "user" | "bundled";
  /** a user kit with the id of a bundled one, which it hides */
  replacesBundled: boolean;
  dir: string;
  /** absolute paths of the logos that are there */
  logo: { onDark?: string; onLight?: string };
  wordmark?: { text: string; color?: string }[];
  tagline: string;
  defaultStyle: string;
  /** what keeps it from showing as it should in a video; empty when fine */
  problems: string[];
}

export interface KitIssue {
  /** the field, dot-separated ("logo.onDark"); "" for the file itself */
  path: string;
  message: string;
}

/** Every brand kit a video can use, the one in use for each id (a user kit before a bundled one). */
export function brandKits(): BrandKitInfo[] {
  return listBrands().map((id) => {
    const dir = brandDir(id)!;
    const source = sourceOf(id, dir);
    const replacesBundled = source === "user" && existsSync(join(bundledBrandsDir(), id, "brand.json"));
    const { value, issues } = readKit(dir);
    const parsed = BrandKitSchema.safeParse(value);
    const kit = parsed.success ? parsed.data : undefined;
    const logo = (file?: string) => {
      const at = file ? lookInside(dir, join(dir, file)) : undefined;
      return at?.st.isFile() ? at.real : undefined;
    };
    return {
      id,
      name: kit?.name ?? id,
      source,
      replacesBundled,
      dir,
      logo: { onDark: logo(kit?.logo.onDark), onLight: logo(kit?.logo.onLight) },
      wordmark: kit?.wordmark,
      tagline: kit?.tagline ?? "",
      defaultStyle: kit?.defaultStyle ?? "",
      problems: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
    };
  });
}

/** Kit `id` as its brand.json has it, for the app's editor: the raw object, unknown fields kept. */
export function readBrandKit(id: string): { id: string; source: "user" | "bundled"; dir: string; value: Record<string, unknown> } {
  if (!isBrandId(id)) throw new Error(`Invalid brand id "${id}": use letters, digits, "-" or "_"`);
  const dir = brandDir(id);
  if (!dir) throw new Error(`Brand kit not found: ${id}`);
  const { value, issues } = readKit(dir);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Brand kit ${id}: ${issues[0]?.message ?? "brand.json is not an object"}`);
  return { id, source: sourceOf(id, dir), dir, value: value as Record<string, unknown> };
}

/**
 * What is wrong with `value` as the brand.json of the kit in `dir`: the
 * schema's problems, then its files (each logo a PNG in the kit's folder,
 * each mascot pose an image there) and its default style.
 */
export function brandKitIssues(dir: string, value: unknown): KitIssue[] {
  const parsed = BrandKitSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  const kit = parsed.data;
  const issues: KitIssue[] = [];
  const file = (path: string, name: string | undefined, kinds: ImageKind[]) => {
    if (!name) return;
    const at = lookInside(dir, join(dir, name));
    if (!at?.st.isFile()) issues.push({ path, message: `${name} is not in the brand kit's folder` });
    else if (!kinds.includes(imageKind(at.real) as ImageKind)) issues.push({ path, message: `${name} is not ${kinds.length === 1 ? "a PNG image" : "a PNG, JPEG or WebP image"}` });
  };
  file("logo.onDark", kit.logo.onDark, ["png"]);
  file("logo.onLight", kit.logo.onLight, ["png"]);
  file("logo.square", kit.logo.square, ["png"]);
  if (kit.mascot?.kind === "image") for (const [pose, name] of Object.entries(kit.mascot.poses)) file(`mascot.poses.${pose}`, name, ["png", "jpeg", "webp"]);
  const styles = listStyles();
  if (!styles.includes(kit.defaultStyle)) issues.push({ path: "defaultStyle", message: `no style "${kit.defaultStyle}"; one of: ${styles.join(", ")}` });
  return issues;
}

export interface LibrarySound {
  /** as scripts and styles name it: its path in the library without the extension ("transition/whoosh-soft") */
  name: string;
  file: string;
  /** its folder in the library ("transition"), "" at the top */
  category: string;
  /** a placeholder the engine made (`_starter/`), used only when none of the user's own files match */
  starter: boolean;
}

/** The sounds in the library, SFX and music. */
export function librarySounds(): { sfx: LibrarySound[]; music: LibrarySound[] } {
  const list = (dir: string) =>
    scanSounds(dir).map((s): LibrarySound => {
      const starter = s.name.startsWith("_starter/");
      const parts = (starter ? s.name.slice("_starter/".length) : s.name).split("/");
      return { name: s.name, file: s.file, category: parts.length > 1 ? parts.slice(0, -1).join("/") : "", starter };
    });
  return { sfx: list(sfxDir()), music: list(musicDir()) };
}

export interface StyleSound {
  /** the style's words for it, in order */
  prefs: string[];
  /** the sounds it can play now (each place picks one): the first word that matches finds them */
  sounds: string[];
  /** only placeholders match (`_starter/`): none of the user's own files */
  starter: boolean;
}

/** What style `id` plays: for each of its events, and as music, the sounds its words find in the library now. */
export function styleSounds(id: string): { sfx: (StyleSound & { event: string; volume: number })[]; music: StyleSound } {
  const style = loadStyle(id);
  const find = (prefs: string[], items: SoundItem[]): StyleSound => {
    const found = soundCandidates(prefs, items);
    const sounds = found?.sounds ?? [];
    return { prefs, sounds: sounds.map((s) => s.name), starter: sounds.length > 0 && sounds.every((s) => s.name.startsWith("_starter/")) };
  };
  const sfx = scanSounds(sfxDir());
  return {
    sfx: Object.entries(style.sfx).map(([event, prefs]) => ({ event, volume: style.sfxVolume[event] ?? 0.3, ...find(prefs, sfx) })),
    music: find(style.music, scanSounds(musicDir())),
  };
}

type ImageKind = "png" | "jpeg" | "webp";

/** What kind of image a file is, by its first bytes. */
function imageKind(file: string): ImageKind | undefined {
  const head = Buffer.alloc(12);
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    readSync(fd, head, 0, 12, 0);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "webp";
  return undefined;
}

function sourceOf(id: string, dir: string): "user" | "bundled" {
  const user = process.env.BRANDS_DIR;
  return user && dir === join(user, id) ? "user" : "bundled";
}

/** brand.json of the kit in `dir`: the parsed value and, when it cannot be read, why. */
function readKit(dir: string): { value: unknown; issues: KitIssue[] } {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(dir, "brand.json"), "utf8"));
  } catch (e) {
    return { value: undefined, issues: [{ path: "", message: `brand.json cannot be read: ${(e as Error).message}` }] };
  }
  return { value, issues: brandKitIssues(dir, value) };
}
