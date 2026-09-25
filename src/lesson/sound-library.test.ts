import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { tokenize, scanSounds, resolveSound, resolveFirst, type SoundItem } from "./sound-library.js";

let dir: string;
let items: SoundItem[];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sounds-"));
  for (const f of [
    "transition/whoosh-soft.mp3",
    "transition/whoosh-hard.wav",
    "ui/pop-bubble.mp3",
    "quiz/tick-tock-clock.mp3",
    "Âm thanh/tiếng-gõ-phím.mp3",
    "_starter/ui/ding-bell.mp3",
    "_starter/transition/swoosh-fast.mp3",
    "notes.txt",
  ]) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), "");
  }
  items = scanSounds(dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const name = (i: SoundItem | null) => i?.name ?? null;

describe("tokenize", () => {
  it("lowercases, strips Vietnamese diacritics and splits on separators", () => {
    expect(tokenize("Tiếng Gõ-Phím_đẹp")).toEqual(["tieng", "go", "phim", "dep"]);
  });
});

describe("scanSounds", () => {
  it("indexes audio files only, by relative name without extension", () => {
    expect(items.map((i) => i.name).sort()).toEqual([
      "_starter/transition/swoosh-fast",
      "_starter/ui/ding-bell",
      "quiz/tick-tock-clock",
      "transition/whoosh-hard",
      "transition/whoosh-soft",
      "ui/pop-bubble",
      "Âm thanh/tiếng-gõ-phím",
    ]);
  });
});

describe("resolveSound", () => {
  it("matches exact paths, basenames and all-words queries", () => {
    expect(name(resolveSound("transition/whoosh-soft", items))).toBe("transition/whoosh-soft");
    expect(name(resolveSound("pop-bubble.mp3", items))).toBe("ui/pop-bubble");
    expect(name(resolveSound("tick tock", items))).toBe("quiz/tick-tock-clock");
    expect(name(resolveSound("go phim", items))).toBe("Âm thanh/tiếng-gõ-phím");
  });

  it("picks deterministically among several matches", () => {
    const a = name(resolveSound("whoosh", items, "scene-1"));
    expect(a).toMatch(/^transition\/whoosh-/);
    expect(name(resolveSound("whoosh", items, "scene-1"))).toBe(a);
  });

  it("uses _starter placeholders only when nothing of yours matches", () => {
    expect(name(resolveSound("ding", items))).toBe("_starter/ui/ding-bell");
    expect(name(resolveSound("swoosh", items))).toBe("_starter/transition/swoosh-fast");
    expect(resolveSound("không có", items)).toBeNull();
    expect(resolveSound("  ", items)).toBeNull();
  });
});

describe("resolveFirst", () => {
  it("prefers your files over starter ones, even for a later preference", () => {
    expect(name(resolveFirst(["ding", "pop"], items, "x"))).toBe("ui/pop-bubble");
  });

  it("tries every preference strictly before any partial-word fallback", () => {
    // "whoosh digital" would partially match a whoosh; "pop" matches fully and wins
    expect(name(resolveFirst(["whoosh digital", "pop"], items, "x"))).toBe("ui/pop-bubble");
    // with no full match anywhere, the partial fallback still finds something
    expect(name(resolveFirst(["whoosh digital"], items, "x"))).toMatch(/^transition\/whoosh-/);
  });
});
