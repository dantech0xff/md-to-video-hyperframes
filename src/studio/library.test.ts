import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundledBrandsDir, parseBrandKit } from "../lesson/brand.js";
import { logoBlock, type Ctx } from "../lesson/compose-kit.js";
import { resolveFirst, scanSounds, soundCandidates } from "../lesson/sound-library.js";
import { brandKitIssues, brandKits, librarySounds, readBrandKit, styleSounds } from "./library.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 0, 64]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

const saved = { BRANDS_DIR: process.env.BRANDS_DIR, SFX_DIR: process.env.SFX_DIR, MUSIC_DIR: process.env.MUSIC_DIR };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const canSymlink = (() => {
  try {
    const d = mkdtempSync(join(tmpdir(), "link-"));
    writeFileSync(join(d, "a"), "");
    symlinkSync(join(d, "a"), join(d, "b"));
    return true;
  } catch {
    return false;
  }
})();

/** A user library of kits: each `files` entry is written in the kit's folder. */
function kits(entries: Record<string, { json: unknown; files?: Record<string, Buffer | string> }>): string {
  const root = mkdtempSync(join(tmpdir(), "brands-"));
  for (const [id, { json, files }] of Object.entries(entries)) {
    mkdirSync(join(root, id));
    writeFileSync(join(root, id, "brand.json"), typeof json === "string" ? json : JSON.stringify(json));
    for (const [name, data] of Object.entries(files ?? {})) {
      mkdirSync(dirname(join(root, id, name)), { recursive: true });
      writeFileSync(join(root, id, name), data);
    }
  }
  return root;
}

describe("brand kits in the library", () => {
  it("lists every kit in use, the user's own before a bundled one of the same id, with what is wrong with it", () => {
    process.env.BRANDS_DIR = kits({
      acme: { json: { name: "Acme", tagline: "Học nhanh", logo: { onDark: "logo.png" }, defaultStyle: "whiteboard" }, files: { "logo.png": PNG } },
      "dan-tech": { json: { name: "Dan Tech (riêng)", wordmark: [{ text: "Dan" }, { text: "Tech", color: "#47c038" }] } },
      broken: { json: "{" },
    });
    const all = brandKits();
    const byId = Object.fromEntries(all.map((k) => [k.id, k]));
    expect(byId.acme).toMatchObject({ name: "Acme", source: "user", replacesBundled: false, tagline: "Học nhanh", defaultStyle: "whiteboard", problems: [] });
    expect(byId.acme.logo.onDark).toMatch(/logo\.png$/);
    expect(byId.acme.logo.onLight).toBeUndefined();
    expect(byId["dan-tech"]).toMatchObject({ name: "Dan Tech (riêng)", source: "user", replacesBundled: true });
    expect(byId.broken.problems[0]).toMatch(/brand\.json cannot be read/);
    // one entry per id
    expect(all.filter((k) => k.id === "dan-tech")).toHaveLength(1);
  });

  it("shows the bundled kit as it ships, with nothing wrong", () => {
    delete process.env.BRANDS_DIR;
    const [dan] = brandKits().filter((k) => k.id === "dan-tech");
    expect(dan).toMatchObject({ source: "bundled", replacesBundled: false, dir: join(bundledBrandsDir(), "dan-tech"), problems: [] });
    expect(readBrandKit("dan-tech")).toMatchObject({ source: "bundled", value: { name: "Dan Tech", socials: { github: "github.com/dantech0xff" } } });
    expect(() => readBrandKit("../dan-tech")).toThrow(/Invalid brand id/);
  });

  it("checks a kit's files and default style, not only its fields", () => {
    const root = kits({ acme: { json: { name: "Acme" }, files: { "logo.png": PNG, "photo.jpg": JPEG, "mascot/idle.jpg": JPEG } } });
    const dir = join(root, "acme");
    expect(brandKitIssues(dir, { name: "Acme", logo: { onDark: "logo.png" }, mascot: { name: "Bot", kind: "image", poses: { idle: "mascot/idle.jpg" } } })).toEqual([]);
    expect(brandKitIssues(dir, { name: "Acme", logo: { onDark: "missing.png", onLight: "photo.jpg" }, defaultStyle: "neon" })).toEqual([
      { path: "logo.onDark", message: "missing.png is not in the brand kit's folder" },
      { path: "logo.onLight", message: "photo.jpg is not a PNG image" },
      { path: "defaultStyle", message: expect.stringMatching(/^no style "neon"; one of: .*dantech/) },
    ]);
    // the schema first: a path out of the folder, a colour that is not one
    const issues = brandKitIssues(dir, { name: "", logo: { onDark: "../x.png" }, wordmark: [{ text: "A", color: "green" }] });
    expect(issues.map((i) => i.path)).toEqual(["name", "logo.onDark", "wordmark.0.color"]);
  });

  it.skipIf(!canSymlink)("takes no logo that a link leads to outside the kit's folder", () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "logo.png"), PNG);
    const root = kits({ acme: { json: { name: "Acme" } } });
    symlinkSync(join(outside, "logo.png"), join(root, "acme", "logo.png"));
    expect(brandKitIssues(join(root, "acme"), { name: "Acme", logo: { onDark: "logo.png" } })).toEqual([{ path: "logo.onDark", message: "logo.png is not in the brand kit's folder" }]);
  });

  it("shows a logo by the style's theme, the other one standing in, and the name when there is none", () => {
    const block = (logo: { onDark?: string; onLight?: string }, theme: "dark" | "light") =>
      logoBlock({ brand: { ...parseBrandKit({ name: "Acme", logo }, "acme", "/kits/acme") }, style: { theme } } as unknown as Ctx, "x");
    expect(block({ onDark: "dark.png", onLight: "light.png" }, "light")).toContain("brand/light.png");
    expect(block({ onDark: "dark.png" }, "light")).toContain("brand/dark.png");
    expect(block({ onLight: "light.png" }, "dark")).toContain("brand/light.png");
    expect(block({}, "dark")).toMatch(/brand-wordmark[\s\S]*<span class="wm-part">Acme<\/span>/);
  });
});

describe("the sound library", () => {
  /** A library with the given files (content does not matter: sounds are known by name). */
  function library(sfx: string[], music: string[] = []) {
    const root = mkdtempSync(join(tmpdir(), "sounds-"));
    for (const [dir, files] of [["sfx", sfx], ["music", music]] as const) {
      for (const f of files) {
        mkdirSync(dirname(join(root, dir, f)), { recursive: true });
        writeFileSync(join(root, dir, f), "");
      }
    }
    process.env.SFX_DIR = join(root, "sfx");
    process.env.MUSIC_DIR = join(root, "music");
    return root;
  }

  it("lists the sounds by name, with their folder and whether they are placeholders", () => {
    library(["transition/whoosh-soft.mp3", "pop.wav", "_starter/ui/pop-bubble.mp3"], ["lofi-chill.mp3"]);
    const { sfx, music } = librarySounds();
    expect(sfx.map(({ name, category, starter }) => ({ name, category, starter }))).toEqual([
      { name: "_starter/ui/pop-bubble", category: "ui", starter: true },
      { name: "pop", category: "", starter: false },
      { name: "transition/whoosh-soft", category: "transition", starter: false },
    ]);
    expect(music.map((m) => m.name)).toEqual(["lofi-chill"]);
  });

  it("tells what a style plays for each event: the user's own files before placeholders", () => {
    library(["transition/whoosh-soft.mp3", "transition/whoosh-hard.mp3", "_starter/ui/pop-bubble.mp3", "_starter/transition/swoosh-fast.mp3"], ["_starter/lofi-loop.mp3"]);
    const { sfx, music } = styleSounds("dantech");
    const by = Object.fromEntries(sfx.map((e) => [e.event, e]));
    expect(by.transition).toMatchObject({ prefs: ["whoosh", "swoosh", "swish", "transition"], sounds: ["transition/whoosh-hard", "transition/whoosh-soft"], starter: false, volume: 0.32 });
    expect(by.reveal).toMatchObject({ sounds: ["_starter/ui/pop-bubble"], starter: true });
    expect(by.wrong).toMatchObject({ sounds: [], starter: false });
    expect(music).toMatchObject({ sounds: ["_starter/lofi-loop"], starter: true });
  });

  it("finds the candidates resolveFirst picks from", () => {
    const root = library(["a/whoosh-1.mp3", "b/whoosh-2.mp3", "swoosh.mp3"]);
    const items = scanSounds(join(root, "sfx"));
    const found = soundCandidates(["whoosh", "swoosh"], items);
    expect(found?.pref).toBe("whoosh");
    for (const seed of ["s1", "s2", "s3", "s4"]) expect(found?.sounds.map((s) => s.name)).toContain(resolveFirst(["whoosh", "swoosh"], items, seed)?.name);
    expect(soundCandidates(["boom"], items)).toBeUndefined();
  });
});
