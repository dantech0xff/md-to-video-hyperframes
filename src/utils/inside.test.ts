import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assertRealInside, readInside, within, writeInside } from "./inside.js";

/** Another process at work between writeInside's steps: right after it makes its new file, and right before the rename. */
const between = vi.hoisted(() => ({ made: undefined as ((path: string) => void) | undefined, rename: undefined as (() => void) | undefined }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
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
    expect(readInside(root, join(root, "script.json"), "script.json").toString()).toBe("one");
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
    // the folder leads outside when the new file is made, then back inside with a hard link to it, then outside again for the rename
    out();
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
