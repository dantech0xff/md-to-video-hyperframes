/**
 * The user's library (design doc §7): brand kits in `brands/<id>/` and sounds
 * in `sounds/sfx/` and `sounds/music/`, in the app's data folder. The engine
 * host lists them and checks a kit; this store changes the files. Only the
 * user's own kits change: a bundled kit is copied first (customizeBrand), and
 * the copy replaces it for every video.
 */
import { randomBytes } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { cp, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { isBrandId } from "../shared/brands";
import { MASCOT_POSES, type BrandImageField, type BrandKitEdit, type BrandKitFile, type Library, type SaveBrandResult, type SoundKind, type StyleSounds } from "../shared/types";
import type { EngineClient } from "./engine";
import { lookInside, readFileInside, resolveInside, within, writeFileInside } from "./fs-guard";
import { claim, slugify } from "./projects";

export const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
export const LOGO_EXTENSIONS = ["png"];
export const POSE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

export interface LibraryDeps {
  engine: Pick<EngineClient, "call">;
  paths: { brands: string; sfx: string; music: string };
  /** moves a file or folder to the trash (Electron's shell.trashItem) */
  trash(path: string): Promise<void>;
}

export class LibraryStore {
  /** changes of a kit run one after another */
  private readonly changing = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: LibraryDeps) {}

  list(): Promise<Library> {
    return this.deps.engine.call("library", undefined);
  }

  readBrand(id: string): Promise<BrandKitFile> {
    if (!isBrandId(id)) throw new Error(`Không có brand kit "${String(id)}"`);
    return this.deps.engine.call("readBrand", { id });
  }

  /** A new kit of the user's named `name`: a copy of kit `from` (its images too), or a blank one. Its id. */
  async createBrand(name: string, from?: string): Promise<string> {
    const title = typeof name === "string" ? name.trim() : "";
    if (!title) throw new Error("Brand kit cần có tên");
    if (title.length > 60) throw new Error("Tên brand kit dài tối đa 60 ký tự");
    const source = from ? await this.readBrand(from) : undefined;
    // an id no kit has, bundled ones included: a kit of the user's with a bundled one's id replaces it
    const taken = new Set((await this.list()).brands.map((b) => b.id));
    const base = slugify(title, 32).replace(/^video$/, "brand");
    let id = base;
    for (let n = 2; taken.has(id) || !(await claim(join(this.deps.paths.brands, id))); n++) id = `${base}-${n}`;
    const dir = join(this.deps.paths.brands, id);
    try {
      if (source) await copyKit(source.dir, dir);
      const value: Record<string, unknown> = source ? { ...source.value, name: title } : blankKit(title);
      delete value.id;
      await writeKit(dir, value);
      return id;
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
  }

  /** The user's own copy of bundled kit `id`, under the same id: it replaces the bundled one in every video. */
  async customizeBrand(id: string): Promise<void> {
    const source = await this.readBrand(id);
    if (source.source !== "bundled") throw new Error("Brand kit này đã là của bạn");
    const dir = join(this.deps.paths.brands, id);
    if (!(await claim(dir))) throw new Error(`Thư viện đã có thư mục "${id}"`);
    try {
      await copyKit(source.dir, dir);
      await writeKit(dir, source.value);
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
  }

  /**
   * Saves kit `id`'s brand.json with the images the user picked. Each image
   * is copied into the kit under a new name, then the engine checks the
   * whole kit: with a problem, nothing changes (the copies go again). Once
   * saved, the images the edit replaced leave the kit.
   */
  saveBrand(id: string, edit: BrandKitEdit): Promise<SaveBrandResult> {
    return this.serially(id, async () => {
      const dir = this.userKit(id);
      const before = parseObject(await readFileInside(dir, join(dir, "brand.json")).catch(() => "{}"));
      const value = structuredClone(edit.value);
      delete value.id;
      const added: string[] = [];
      const removeAdded = () => Promise.all(added.map((name) => rm(join(dir, name), { force: true })));
      try {
        for (const [field, source] of Object.entries(edit.images) as [BrandImageField, string][]) {
          const ext = extname(source).toLowerCase();
          if (!imageField(field)) throw new Error(`"${field}" không phải ô ảnh của brand kit`);
          if (!(field.startsWith("logo.") ? LOGO_EXTENSIONS : POSE_EXTENSIONS).includes(ext.slice(1))) throw new Error(`${basename(source)}: ${field.startsWith("logo.") ? "logo phải là ảnh PNG" : "ảnh phải là PNG, JPEG hoặc WebP"}`);
          const name = `${field.replace(/\./g, "-")}-${randomBytes(3).toString("hex")}${ext}`;
          await writeFileInside(dir, join(dir, name), await readFile(source));
          added.push(name);
          setImage(value, field, name);
        }
        const issues = await this.deps.engine.call("checkBrand", { dir, value });
        if (issues.length) {
          await removeAdded();
          return { ok: false, issues };
        }
        await writeKit(dir, value);
      } catch (e) {
        await removeAdded();
        throw e;
      }
      // images the old brand.json named and the new one does not: the ones this edit replaced
      const kept = new Set(kitImages(value));
      for (const name of kitImages(before)) {
        const at = kept.has(name) ? undefined : lookInside(dir, join(dir, name));
        if (at?.st.isFile()) await rm(at.real, { force: true });
      }
      return { ok: true, issues: [] };
    });
  }

  /** Moves kit `id` of the user's to the trash (a bundled one with its id shows again). */
  deleteBrand(id: string): Promise<void> {
    return this.serially(id, () => this.deps.trash(this.userKit(id)));
  }

  /** The folder to open: the library's brand kits or sounds, or kit `brandId`. */
  folder(folder: "brands" | SoundKind, brandId?: string): string {
    if (folder !== "brands") return this.soundDir(folder);
    return brandId === undefined ? this.deps.paths.brands : this.userKit(brandId);
  }

  /** Copies audio files the user picked into the library, into folder `category` ("" at the top), under names not yet used. Their names. */
  async importSounds(kind: SoundKind, files: string[], category: string): Promise<string[]> {
    const root = this.soundDir(kind);
    if (category && !/^[\p{L}\p{N}_ -]{1,40}$/u.test(category.trim())) throw new Error("Tên thư mục chỉ gồm chữ, số, dấu cách, - và _ (tối đa 40 ký tự)");
    const dir = category ? join(root, category.trim()) : root;
    if (!resolveInside(root, dir)) throw new Error("Thư mục này dẫn ra ngoài thư viện âm thanh");
    await mkdir(dir, { recursive: true });
    const names: string[] = [];
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext.slice(1))) throw new Error(`${basename(file)}: chỉ nhận file âm thanh ${AUDIO_EXTENSIONS.join(", ")}`);
      const name = freeSoundName(dir, basename(file));
      await writeFileInside(root, join(dir, name), await readFile(file));
      names.push(soundName(root, join(dir, name)));
    }
    return names;
  }

  /** Renames a sound of the library, its folder and extension kept: scripts and styles pick sounds by name. Its new name. */
  async renameSound(kind: SoundKind, file: string, name: string): Promise<string> {
    const root = this.soundDir(kind);
    const from = await this.soundFile(root, file);
    const stem = typeof name === "string" ? name.trim() : "";
    if (!/^[\p{L}\p{N}_ .-]{1,80}$/u.test(stem) || stem.startsWith(".")) throw new Error("Tên file chỉ gồm chữ, số, dấu cách, dấu chấm, - và _ (tối đa 80 ký tự)");
    const to = join(dirname(from), `${stem}${extname(from)}`);
    if (to === from) return soundName(root, from);
    // the extension does not tell sounds apart: whoosh.mp3 and whoosh.wav would both be "whoosh"
    const others = soundStems(dirname(from), basename(from));
    // only the case changing ("Pop" to "pop"): on macOS and Windows the file found at the new name is this one
    const sameFile = to.toLowerCase() === from.toLowerCase();
    if (others.has(stem.toLowerCase()) || (!sameFile && lstatSync(to, { throwIfNoEntry: false }))) throw new Error(`Đã có âm thanh tên "${stem}" trong thư mục này`);
    await rename(from, to);
    return soundName(root, to);
  }

  async deleteSound(kind: SoundKind, file: string): Promise<void> {
    const root = this.soundDir(kind);
    await this.deps.trash(await this.soundFile(root, file));
  }

  async starterSounds(): Promise<number> {
    return (await this.deps.engine.call("starterSounds", undefined)).made;
  }

  styleSounds(style: string): Promise<StyleSounds> {
    if (typeof style !== "string" || !/^[\w-]+$/.test(style)) throw new Error(`Không có style "${String(style)}"`);
    return this.deps.engine.call("styleSounds", { style });
  }

  private soundDir(kind: SoundKind): string {
    if (kind !== "sfx" && kind !== "music") throw new Error(`Không có thư viện "${String(kind)}"`);
    return kind === "sfx" ? this.deps.paths.sfx : this.deps.paths.music;
  }

  /** `file`, a sound of the library at `root`: a regular file inside it (a link is not one), with an audio extension. */
  private async soundFile(root: string, file: string): Promise<string> {
    const inside = typeof file === "string" && within(root, file) && resolveInside(root, dirname(file));
    const st = inside ? await lstat(file).catch(() => undefined) : undefined;
    if (!st?.isFile() || !AUDIO_EXTENSIONS.includes(extname(file).slice(1).toLowerCase())) throw new Error("Không thấy file âm thanh này trong thư viện");
    return file;
  }

  /** The folder of kit `id` of the user's: a real folder in the library, never a link. */
  private userKit(id: string): string {
    if (!isBrandId(id)) throw new Error(`Không có brand kit "${String(id)}"`);
    const dir = join(this.deps.paths.brands, id);
    const st = lstatSync(dir, { throwIfNoEntry: false });
    if (!st?.isDirectory()) throw new Error(`Brand kit "${id}" không phải của bạn: bấm Tuỳ chỉnh để có bản riêng`);
    return dir;
  }

  private serially<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.changing.get(id) ?? Promise.resolve()).then(fn);
    const settled = run.catch(() => undefined);
    this.changing.set(id, settled);
    void settled.then(() => {
      if (this.changing.get(id) === settled) this.changing.delete(id);
    });
    return run;
  }
}

/** A new kit's brand.json: the name as its wordmark, a call to action to follow it. */
export function blankKit(name: string): Record<string, unknown> {
  const cta = { title: `Theo dõi ${name}`.slice(0, 80), subtitle: "" };
  return { name, tagline: "", website: "", handle: "", wordmark: [{ text: name.slice(0, 30) }], defaultStyle: "dantech", cta: { landscape: cta, portrait: { ...cta } } };
}

/** The images a brand.json names, by their paths in the kit's folder. */
export function kitImages(value: Record<string, unknown>): string[] {
  const out: string[] = [];
  const logo = value.logo as Record<string, unknown> | undefined;
  for (const key of ["onDark", "onLight", "square"]) if (typeof logo?.[key] === "string") out.push(logo[key] as string);
  const poses = (value.mascot as { poses?: Record<string, unknown> } | undefined)?.poses;
  for (const pose of MASCOT_POSES) if (typeof poses?.[pose] === "string") out.push(poses[pose] as string);
  return out;
}

function imageField(field: string): field is BrandImageField {
  return ["logo.onDark", "logo.onLight", "logo.square", ...MASCOT_POSES.map((p) => `mascot.poses.${p}`)].includes(field);
}

/** Names image `name` in `value` at `field` ("logo.onDark", "mascot.poses.idle"). */
function setImage(value: Record<string, unknown>, field: BrandImageField, name: string): void {
  const [head, ...rest] = field.split(".");
  let at = value;
  for (const key of [head, ...rest.slice(0, -1)]) {
    const next = at[key];
    at[key] = next && typeof next === "object" && !Array.isArray(next) ? { ...(next as Record<string, unknown>) } : {};
    at = at[key] as Record<string, unknown>;
  }
  at[rest[rest.length - 1]] = name;
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Writes a kit's brand.json through a new file checked inside the kit (the app's own files, as in a project). */
async function writeKit(dir: string, value: Record<string, unknown>): Promise<void> {
  await writeFileInside(dir, join(dir, "brand.json"), `${JSON.stringify(value, null, 2)}\n`);
}

/** Copies a kit's files into `to`: folders and regular files, never a link, never its brand.json (written after). */
async function copyKit(from: string, to: string): Promise<void> {
  await cp(from, to, {
    recursive: true,
    filter: async (source) => {
      if (source === from) return true;
      if (relative(from, source) === "brand.json") return false;
      const st = await lstat(source);
      return st.isDirectory() || st.isFile();
    },
  });
}

/** The names of the sounds in `dir` (lowercase, without extension), `except` one file. */
function soundStems(dir: string, except?: string): Set<string> {
  const files = readdirSync(dir).filter((f) => f !== except && AUDIO_EXTENSIONS.includes(extname(f).slice(1).toLowerCase()));
  return new Set(files.map((f) => basename(f, extname(f)).toLowerCase()));
}

/** A file name for `name` in `dir` that no sound there has, whatever its extension: "pop.wav", "pop-2.wav"… */
function freeSoundName(dir: string, name: string): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  const taken = soundStems(dir);
  let candidate = stem;
  for (let n = 2; taken.has(candidate.toLowerCase()) || lstatSync(join(dir, candidate + ext), { throwIfNoEntry: false }); n++) candidate = `${stem}-${n}`;
  return candidate + ext;
}

/** A sound's name in the library, as scripts and styles give it: its path without the extension, "/" between folders. */
function soundName(root: string, file: string): string {
  const rel = relative(root, file);
  return rel.slice(0, rel.length - extname(rel).length).split(sep).join("/");
}
