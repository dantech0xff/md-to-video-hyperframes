import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { realpathSync } from "node:fs";
import { assertRealInside, lookInside, readInside, resolveInside, within, writeInside } from "./inside.js";

/**
 * Another process at work between writeInside's steps: right before and right
 * after it makes its new file, and right before the rename. `touched`, when
 * set, collects every path looked up.
 */
const between = vi.hoisted(() => ({
  opening: undefined as (() => void) | undefined,
  made: undefined as ((path: string) => void) | undefined,
  rename: undefined as (() => void) | undefined,
  touched: undefined as string[] | undefined,
}));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  // each lookup as "call\0path"
  const looks = <F extends (p: import("node:fs").PathLike, ...rest: never[]) => unknown>(call: string, f: F) =>
    ((p: import("node:fs").PathLike, ...rest: never[]) => {
      between.touched?.push(`${call}\0${String(p)}`);
      return f(p, ...rest);
    }) as unknown as F;
  return {
    ...fs,
    lstatSync: looks("lstat", fs.lstatSync),
    statSync: looks("stat", fs.statSync),
    readlinkSync: looks("readlink", fs.readlinkSync),
    realpathSync: looks("realpath", fs.realpathSync),
    existsSync: looks("exists", fs.existsSync),
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      between.touched?.push(`open\0${String(args[0])}`);
      if (args[1] === "wx") {
        const before = between.opening;
        between.opening = undefined;
        before?.();
      }
      const fd = fs.openSync(...args);
      const then = args[1] === "wx" ? between.made : undefined;
      between.made = undefined;
      then?.(String(args[0]));
      return fd;
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      const then = between.rename;
      between.rename = undefined;
      then?.();
      return fs.renameSync(...args);
    },
  };
});

const canSymlink = (() => {
  try {
    const d = mkdtempSync(join(tmpdir(), "link-"));
    symlinkSync(d, join(d, "self"), "dir");
    return true;
  } catch {
    return false;
  }
})();

describe("inside", () => {
  it("tells whether a path is inside a folder as written", () => {
    const root = join(tmpdir(), "p");
    expect(within(root, join(root, "a", "b"))).toBe(true);
    expect(within(root, root)).toBe(true);
    expect(within(root, join(root, "..", "q"))).toBe(false);
  });

  it("takes a folder inside the project, made or not yet", () => {
    const root = mkdtempSync(join(tmpdir(), "inside-"));
    mkdirSync(join(root, "portrait"));
    expect(() => assertRealInside(root, join(root, "portrait"))).not.toThrow();
    expect(() => assertRealInside(root, join(root, "portrait", "media", "x"))).not.toThrow();
  });

  it.skipIf(!canSymlink)("refuses a folder that a link takes out of the project, a broken link too", () => {
    const root = mkdtempSync(join(tmpdir(), "inside-"));
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    symlinkSync(outside, join(root, "portrait"), "dir");
    expect(() => assertRealInside(root, join(root, "portrait"))).toThrow(/portrait leads outside the project folder through a symbolic link/);
    // a folder not made yet, under the link
    expect(() => assertRealInside(root, join(root, "portrait", "media"))).toThrow(/through a symbolic link/);
    symlinkSync(join(outside, "gone"), join(root, "landscape"), "dir");
    expect(() => assertRealInside(root, join(root, "landscape"))).toThrow(/through a symbolic link/);
    // a link that stays inside is fine
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "alias"), "dir");
    expect(() => assertRealInside(root, join(root, "alias"))).not.toThrow();
  });
});

describe("reading and writing inside a folder", () => {
  it("reads a file inside, and replaces one through a new file", () => {
    const root = mkdtempSync(join(tmpdir(), "inside-"));
    writeFileSync(join(root, "script.json"), "one");
    const read = readInside(root, join(root, "script.json"), "script.json");
    expect(read.data.toString()).toBe("one");
    // when the file read last changed, as a lookup of it says
    const st = statSync(join(root, "script.json"));
    expect(read.changedAt).toBe(Math.max(st.mtimeMs, st.ctimeMs));
    writeInside(root, join(root, "script.json"), "two");
    expect(readFileSync(join(root, "script.json"), "utf8")).toBe("two");
    // the new file took the old one's place: nothing else is left
    expect(readdirSync(root)).toEqual(["script.json"]);
  });

  it.skipIf(!canSymlink)("reads nothing through a link out of the folder, and writes nothing through a folder that leads out", () => {
    const root = mkdtempSync(join(tmpdir(), "inside-"));
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.json"), "secret");
    symlinkSync(join(outside, "secret.json"), join(root, "script.json"));
    expect(() => readInside(root, join(root, "script.json"), "script.json")).toThrow(/script\.json leads outside the project folder through a symbolic link/);
    symlinkSync(outside, join(root, "short"), "dir");
    expect(() => writeInside(root, join(root, "short", "script.json"), "data")).toThrow(/short leads outside the project folder through a symbolic link/);
    // the new file made there is gone again
    expect(readdirSync(outside)).toEqual(["secret.json"]);
  });

  it.skipIf(process.platform === "win32")("refuses a named pipe instead of waiting for a writer", { timeout: 2_000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "inside-"));
    execFileSync("mkfifo", [join(root, "script.json")]);
    expect(() => readInside(root, join(root, "script.json"), "script.json")).toThrow(/script\.json is not a regular file/);
  });
});

describe("a folder switched for a link while writeInside works", () => {
  /** A project with a Short's script, and a folder outside it with a script of its own. */
  function folders() {
    const root = mkdtempSync(join(tmpdir(), "inside-"));
    mkdirSync(join(root, "short"));
    writeFileSync(join(root, "short", "script.json"), "mine");
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "script.json"), "theirs");
    const out = () => {
      renameSync(join(root, "short"), join(root, "short-real"));
      symlinkSync(outside, join(root, "short"), "dir");
    };
    const back = () => {
      unlinkSync(join(root, "short"));
      renameSync(join(root, "short-real"), join(root, "short"));
    };
    return { root, outside, out, back };
  }

  it.skipIf(!canSymlink)("after the check: the rename finds no new file there and replaces nothing", () => {
    const { root, outside, out } = folders();
    between.rename = out;
    expect(() => writeInside(root, join(root, "short", "script.json"), "edited")).toThrow(/ENOENT/);
    expect(readFileSync(join(outside, "script.json"), "utf8")).toBe("theirs");
    expect(readdirSync(outside)).toEqual(["script.json"]);
  });

  // a hard link to a file in another folder, and folders renamed with links in them: not on Windows
  it.skipIf(!canSymlink || process.platform === "win32")("around the check, with another name made for the new file: refused before anything is written", () => {
    const { root, outside, out, back } = folders();
    // the folder leads outside when the new file is made (after the first check), then back inside with a hard link to it, then outside again for the rename
    between.opening = out;
    between.made = (tmp) => {
      back();
      linkSync(join(outside, basename(tmp)), join(root, "short", basename(tmp)));
      between.rename = out;
    };
    expect(() => writeInside(root, join(root, "short", "script.json"), "edited")).toThrow(/short leads outside the project folder/);
    expect(readFileSync(join(outside, "script.json"), "utf8")).toBe("theirs");
    between.rename = undefined;
  });
});

describe("links resolved one at a time", () => {
  /** A project with a photo, and a folder outside it with a photo of its own. */
  function folders() {
    const root = mkdtempSync(join(tmpdir(), "inside-"));
    mkdirSync(join(root, "sources"));
    writeFileSync(join(root, "sources", "photo.jpg"), "photo");
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "photo.jpg"), "theirs");
    return { root, outside };
  }

  /**
   * The lookups `fn` makes that the system would take out of `root` through a
   * link: lstat and readlink follow the folders on the way, the others the
   * name itself too.
   */
  function followedOut(root: string, fn: () => unknown): string[] {
    const touched: string[] = [];
    between.touched = touched;
    try {
      fn();
    } finally {
      between.touched = undefined;
    }
    const realRoot = realpathSync(root);
    return touched.filter((entry) => {
      const [call, p] = entry.split("\0");
      const followed = call === "lstat" || call === "readlink" ? dirname(p) : p;
      // not made yet: where its nearest existing folder leads
      for (let cur = followed; ; cur = dirname(cur)) {
        try {
          return !within(realRoot, join(realpathSync(cur), relative(cur, followed)));
        } catch {
          if (dirname(cur) === cur) return true;
        }
      }
    });
  }

  it.skipIf(!canSymlink)("follows a link that stays inside: relative, or absolute under the project's path as given or real", () => {
    const { root } = folders();
    const photo = join(realpathSync(root), "sources", "photo.jpg");
    mkdirSync(join(root, "short"));
    symlinkSync(join("..", "sources"), join(root, "short", "sources"), "dir");
    symlinkSync(join(root, "sources", "photo.jpg"), join(root, "given.jpg"));
    symlinkSync(photo, join(root, "real.jpg"));
    for (const p of [join(root, "short", "sources", "photo.jpg"), join(root, "given.jpg"), join(root, "real.jpg")]) {
      expect(resolveInside(root, p)).toEqual({ real: photo, missing: false });
      expect(readInside(root, p, "photo").data.toString()).toBe("photo");
    }
    // not made yet: where it would be
    expect(resolveInside(root, join(root, "portrait", "media"))).toEqual({ real: join(realpathSync(root), "portrait", "media"), missing: true });
    expect(lookInside(root, join(root, "portrait"))).toBeUndefined();
  });

  it.skipIf(!canSymlink)("never looks up a target outside: absolute, climbing out, through a link on the way, or a loop", () => {
    const { root, outside } = folders();
    // absolute, and relative climbing out of the project
    symlinkSync(join(outside, "photo.jpg"), join(root, "sources", "out.jpg"));
    symlinkSync(join("..", "..", basename(outside), "photo.jpg"), join(root, "sources", "up.jpg"));
    // "sub/../photo.jpg": sub's parent, outside, not the project's photo
    mkdirSync(join(outside, "deep"));
    symlinkSync(join(outside, "deep"), join(root, "sub"), "dir");
    symlinkSync(["sub", "..", "photo.jpg"].join(sep), join(root, "via.jpg"));
    // each the other's target
    symlinkSync("b", join(root, "a"));
    symlinkSync("a", join(root, "b"));
    const images = ["sources/out.jpg", "sources/up.jpg", "via.jpg", "a"].map((p) => join(root, p));
    const out = followedOut(root, () => {
      for (const p of images) {
        expect(resolveInside(root, p)).toBeUndefined();
        expect(lookInside(root, p)).toBeUndefined();
        expect(() => readInside(root, p, "image")).toThrow(/leads outside the project folder through a symbolic link/);
      }
      expect(() => assertRealInside(root, join(root, "sub", "media"))).toThrow(/through a symbolic link/);
      expect(() => writeInside(root, join(root, "sub", "photo.jpg"), "mine")).toThrow(/through a symbolic link/);
    });
    expect(out).toEqual([]);
    expect(readdirSync(join(outside, "deep"))).toEqual([]);
  });

  it("reads which file it read, by its inode number", () => {
    const { root } = folders();
    const photo = join(root, "sources", "photo.jpg");
    expect(readInside(root, photo, "photo").fileId).toBe(String(statSync(photo, { bigint: true }).ino));
  });
});
