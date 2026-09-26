/**
 * The library's store against the real engine host (npm run build in the repo
 * root first, as CI does), with its own brand kits and sounds folders.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHostService } from "../engine/service";
import { LibraryStore } from "./library";

const ENGINE = resolve(__dirname, "..", "..", "..");
const built = existsSync(join(ENGINE, "dist", "studio", "engine.js"));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 0, 64]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

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

describe.skipIf(!built)("the library store", () => {
  const service = createHostService(() => undefined);
  afterAll(() => service.close());
  const saved = { BRANDS_DIR: process.env.BRANDS_DIR, SFX_DIR: process.env.SFX_DIR, MUSIC_DIR: process.env.MUSIC_DIR };
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  let paths: { brands: string; sfx: string; music: string };
  let trashed: string[];
  let library: LibraryStore;
  /** picked files, outside the library */
  let picked: string;

  beforeEach(async () => {
    await service.handle("init", { engineRoot: ENGINE });
    const data = mkdtempSync(join(tmpdir(), "library-"));
    paths = { brands: join(data, "brands"), sfx: join(data, "sounds", "sfx"), music: join(data, "sounds", "music") };
    for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
    // as the app starts the engine host
    process.env.BRANDS_DIR = paths.brands;
    process.env.SFX_DIR = paths.sfx;
    process.env.MUSIC_DIR = paths.music;
    trashed = [];
    library = new LibraryStore({
      engine: { call: ((method: never, params: never) => service.handle(method, params)) as never },
      paths,
      trash: async (path) => void trashed.push(path),
    });
    picked = mkdtempSync(join(tmpdir(), "picked-"));
    writeFileSync(join(picked, "logo.png"), PNG);
    writeFileSync(join(picked, "logo-2.png"), PNG);
    writeFileSync(join(picked, "photo.png"), JPEG);
    writeFileSync(join(picked, "logo.gif"), "GIF89a");
    for (const name of ["whoosh.mp3", "pop.wav", "notes.txt"]) writeFileSync(join(picked, name), "x");
  });

  const kit = (id: string) => JSON.parse(readFileSync(join(paths.brands, id, "brand.json"), "utf8")) as Record<string, unknown>;

  it("makes a blank kit, or a copy of another with its images, under an id no kit has", async () => {
    expect(await library.createBrand("Acme Academy")).toBe("acme-academy");
    expect(kit("acme-academy")).toMatchObject({ name: "Acme Academy", wordmark: [{ text: "Acme Academy" }], defaultStyle: "dantech" });
    // "dan-tech" is the bundled kit's: a copy gets another id
    expect(await library.createBrand("Dan Tech", "dan-tech")).toBe("dan-tech-2");
    expect(readdirSync(join(paths.brands, "dan-tech-2")).sort()).toEqual(["brand.json", "logo-square.png", "logo-wordmark-on-light.png", "logo-wordmark.png"]);
    expect(kit("dan-tech-2")).toMatchObject({ name: "Dan Tech", tagline: "Build mobile apps với AI Native Power" });
    expect(kit("dan-tech-2").id).toBeUndefined();
    const listed = (await library.list()).brands;
    expect(listed.find((b) => b.id === "acme-academy")).toMatchObject({ source: "user", problems: [] });
    expect(listed.find((b) => b.id === "dan-tech-2")).toMatchObject({ source: "user", replacesBundled: false, problems: [] });
    await expect(library.createBrand("  ")).rejects.toThrow(/cần có tên/);
  });

  it("copies a bundled kit under its own id, which then replaces it", async () => {
    await library.customizeBrand("dan-tech");
    expect(kit("dan-tech")).toMatchObject({ name: "Dan Tech" });
    expect((await library.list()).brands.find((b) => b.id === "dan-tech")).toMatchObject({ source: "user", replacesBundled: true });
    await expect(library.customizeBrand("dan-tech")).rejects.toThrow(/đã là của bạn/);
  });

  it("saves a kit with the images picked, replaces the old ones, and changes nothing when the engine finds a problem", async () => {
    const id = await library.createBrand("Acme");
    const value = { ...kit(id), tagline: "Học nhanh" };
    expect(await library.saveBrand(id, { value, images: { "logo.onDark": join(picked, "logo.png") } })).toEqual({ ok: true, issues: [] });
    const first = (kit(id).logo as { onDark: string }).onDark;
    expect(first).toMatch(/^logo-onDark-[0-9a-f]{6}\.png$/);
    expect(kit(id).tagline).toBe("Học nhanh");
    expect(readFileSync(join(paths.brands, id, first))).toEqual(PNG);

    // a new logo: the old one leaves the kit
    await library.saveBrand(id, { value: kit(id), images: { "logo.onDark": join(picked, "logo-2.png") } });
    const second = (kit(id).logo as { onDark: string }).onDark;
    expect(second).not.toBe(first);
    expect(existsSync(join(paths.brands, id, first))).toBe(false);

    // the engine's problems: nothing written, the copied image gone again
    const before = readFileSync(join(paths.brands, id, "brand.json"), "utf8");
    const files = readdirSync(join(paths.brands, id)).sort();
    const notPng = await library.saveBrand(id, { value: kit(id), images: { "logo.onLight": join(picked, "photo.png") } });
    expect(notPng).toEqual({ ok: false, issues: [{ path: "logo.onLight", message: expect.stringMatching(/is not a PNG image/) }] });
    const badStyle = await library.saveBrand(id, { value: { ...kit(id), defaultStyle: "neon" }, images: {} });
    expect(badStyle.issues).toEqual([{ path: "defaultStyle", message: expect.stringMatching(/^no style "neon"/) }]);
    expect(readFileSync(join(paths.brands, id, "brand.json"), "utf8")).toBe(before);
    expect(readdirSync(join(paths.brands, id)).sort()).toEqual(files);

    await expect(library.saveBrand(id, { value: kit(id), images: { "logo.onDark": join(picked, "logo.gif") } })).rejects.toThrow(/logo phải là ảnh PNG/);
    // a bundled kit changes only through the user's copy
    await expect(library.saveBrand("dan-tech", { value: {}, images: {} })).rejects.toThrow(/không phải của bạn/);
    await expect(library.saveBrand("../x", { value: {}, images: {} })).rejects.toThrow(/Không có brand kit/);
  });

  it("names the mascot's pose images in its poses", async () => {
    const id = await library.createBrand("Acme");
    const value = { ...kit(id), mascot: { name: "Bot", kind: "image", poses: {} } };
    const saved = await library.saveBrand(id, { value, images: { "mascot.poses.idle": join(picked, "logo.png") } });
    expect(saved.ok).toBe(true);
    expect(kit(id).mascot).toEqual({ name: "Bot", kind: "image", poses: { idle: expect.stringMatching(/^mascot-poses-idle-[0-9a-f]{6}\.png$/) } });
  });

  it("moves a kit of the user's to the trash, never a bundled one", async () => {
    const id = await library.createBrand("Acme");
    await library.deleteBrand(id);
    expect(trashed).toEqual([join(paths.brands, id)]);
    await expect(library.deleteBrand("dan-tech")).rejects.toThrow(/không phải của bạn/);
  });

  it("adds sounds the user picked under names not taken, renames and removes them", async () => {
    expect(await library.importSounds("sfx", [join(picked, "whoosh.mp3"), join(picked, "pop.wav")], "transition")).toEqual(["transition/whoosh", "transition/pop"]);
    expect(await library.importSounds("sfx", [join(picked, "whoosh.mp3")], "transition")).toEqual(["transition/whoosh-2"]);
    expect(await library.importSounds("music", [join(picked, "whoosh.mp3")], "")).toEqual(["whoosh"]);
    // another extension is the same sound: pop.mp3 next to pop.wav would both be "transition/pop"
    writeFileSync(join(picked, "pop.mp3"), "x");
    expect(await library.importSounds("sfx", [join(picked, "pop.mp3")], "transition")).toEqual(["transition/pop-2"]);
    await expect(library.importSounds("sfx", [join(picked, "notes.txt")], "")).rejects.toThrow(/chỉ nhận file âm thanh/);
    await expect(library.importSounds("sfx", [join(picked, "pop.wav")], "../out")).rejects.toThrow(/Tên thư mục/);

    const file = join(paths.sfx, "transition", "whoosh.mp3");
    // only its case: never "taken" by itself
    expect(await library.renameSound("sfx", file, "Whoosh")).toBe("transition/Whoosh");
    expect(await library.renameSound("sfx", join(paths.sfx, "transition", "Whoosh.mp3"), "whoosh-soft")).toBe("transition/whoosh-soft");
    expect(existsSync(join(paths.sfx, "transition", "whoosh-soft.mp3"))).toBe(true);
    await expect(library.renameSound("sfx", join(paths.sfx, "transition", "pop.wav"), "Whoosh-2")).rejects.toThrow(/Đã có âm thanh tên "Whoosh-2"/);
    await expect(library.renameSound("sfx", join(paths.sfx, "transition", "pop.wav"), "a/b")).rejects.toThrow(/Tên file/);
    await expect(library.renameSound("sfx", join(picked, "pop.wav"), "x")).rejects.toThrow(/Không thấy file âm thanh/);
    // the library shows them by name
    expect((await library.list()).sfx.map((s) => s.name).sort()).toEqual(["transition/pop", "transition/pop-2", "transition/whoosh-2", "transition/whoosh-soft"]);

    await library.deleteSound("sfx", join(paths.sfx, "transition", "pop.wav"));
    expect(trashed).toEqual([join(paths.sfx, "transition", "pop.wav")]);
  });

  it.skipIf(!canSymlink)("renames or removes no link the library holds, nor a file it leads to", async () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "theirs.mp3"), "x");
    symlinkSync(join(outside, "theirs.mp3"), join(paths.sfx, "linked.mp3"));
    await expect(library.deleteSound("sfx", join(paths.sfx, "linked.mp3"))).rejects.toThrow(/Không thấy file âm thanh/);
    symlinkSync(outside, join(paths.sfx, "folder"), "dir");
    await expect(library.renameSound("sfx", join(paths.sfx, "folder", "theirs.mp3"), "mine")).rejects.toThrow(/Không thấy file âm thanh/);
    expect(trashed).toEqual([]);
    expect(readdirSync(outside)).toEqual(["theirs.mp3"]);
  });

  it("tells what a style plays from the library", async () => {
    await library.importSounds("sfx", [join(picked, "whoosh.mp3")], "transition");
    const sounds = await library.styleSounds("dantech");
    expect(sounds.sfx.find((e) => e.event === "transition")).toMatchObject({ sounds: ["transition/whoosh"], starter: false });
    expect(() => library.styleSounds("../x")).toThrow(/Không có style/);
  });
});
