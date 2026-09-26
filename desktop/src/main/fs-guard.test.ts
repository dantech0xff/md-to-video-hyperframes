import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { isInside, lookInside, readFileInside, readTextInside, resolveInside, within, writeFileInside } from "./fs-guard";

/**
 * Another process at work between writeFileInside's steps: right before and
 * right after it makes its new file, and right before the rename. `paths`,
 * when set, collects every path looked up, as "call\0path".
 */
const between = vi.hoisted(() => ({
  opening: undefined as (() => void) | undefined,
  made: undefined as ((path: string) => void) | undefined,
  rename: undefined as (() => void) | undefined,
  paths: undefined as string[] | undefined,
}));
const recording = vi.hoisted(() => <M extends object>(fs: M, calls: Record<string, string>): M => {
  const out: Record<string, unknown> = { ...(fs as Record<string, unknown>) };
  for (const [name, call] of Object.entries(calls)) {
    const f = (fs as Record<string, (...args: unknown[]) => unknown>)[name];
    out[name] = Object.assign((...args: unknown[]) => {
      if (typeof args[0] === "string") between.paths?.push(`${call}\0${args[0]}`);
      return f(...args);
    }, f);
  }
  return out as M;
});
vi.mock("node:fs", async (importOriginal) =>
  recording(await importOriginal<typeof import("node:fs")>(), {
    lstatSync: "lstat",
    statSync: "stat",
    readlinkSync: "readlink",
    realpathSync: "realpath",
    existsSync: "exists",
    openSync: "open",
    readFileSync: "read",
  }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...recording(fs, { lstat: "lstat", stat: "stat", readFile: "read", realpath: "realpath" }),
    open: async (...args: Parameters<typeof fs.open>) => {
      between.paths?.push(`open\0${String(args[0])}`);
      if (args[1] === "wx") {
        const before = between.opening;
        between.opening = undefined;
        before?.();
      }
      const file = await fs.open(...args);
      const then = args[1] === "wx" ? between.made : undefined;
      between.made = undefined;
      then?.(String(args[0]));
      return file;
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      const then = between.rename;
      between.rename = undefined;
      then?.();
      return fs.rename(...args);
    },
  };
});

/**
 * The lookups `fn` makes that the system takes out of `root` through a link:
 * lstat and readlink follow the folders on the way, the others the name
 * itself too.
 */
async function followedOut(root: string, fn: () => Promise<unknown>): Promise<string[]> {
  const paths: string[] = [];
  between.paths = paths;
  try {
    await fn();
  } finally {
    between.paths = undefined;
  }
  const realRoot = realpathSync(root);
  return paths.filter((entry) => {
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

const canSymlink = (() => {
  try {
    const d = mkdtempSync(join(tmpdir(), "link-"));
    symlinkSync(d, join(d, "self"), "dir");
    return true;
  } catch {
    return false;
  }
})();

/** A project folder with project.json, and a folder outside it with a file of the user's. */
function folders() {
  const root = mkdtempSync(join(tmpdir(), "guard-project-"));
  writeFileSync(join(root, "project.json"), "{}\n");
  const outside = mkdtempSync(join(tmpdir(), "guard-outside-"));
  writeFileSync(join(outside, "notes.json"), '{"mine": true}\n');
  return { root, outside };
}

describe("the app's own files in a project folder", () => {
  it("reads a file inside, and replaces one through a new file that leaves nothing behind", async () => {
    const { root } = folders();
    expect(await readFileInside(root, join(root, "project.json"))).toBe("{}\n");
    await writeFileInside(root, join(root, "project.json"), '{"v": 2}\n');
    expect(readFileSync(join(root, "project.json"), "utf8")).toBe('{"v": 2}\n');
    expect(readdirSync(root)).toEqual(["project.json"]);
  });

  it.skipIf(!canSymlink)("replaces a link the agent left in a file's place, or beside it, instead of writing through it", async () => {
    const { root, outside } = folders();
    // the old fixed name of the new file, and the file itself
    symlinkSync(join(outside, "notes.json"), join(root, "project.json.tmp"));
    await writeFileInside(root, join(root, "project.json"), '{"v": 2}\n');
    symlinkSync(join(outside, "notes.json"), join(root, "AGENTS.md"));
    await writeFileInside(root, join(root, "AGENTS.md"), "# Agents\n");
    expect(readFileSync(join(outside, "notes.json"), "utf8")).toBe('{"mine": true}\n');
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# Agents\n");
  });

  it.skipIf(!canSymlink)("reads nothing through a link out of the project, and writes nothing through a folder that leads out", async () => {
    const { root, outside } = folders();
    symlinkSync(join(outside, "notes.json"), join(root, "linked.json"));
    await expect(readFileInside(root, join(root, "linked.json"))).rejects.toThrow(/linked\.json leads outside the project folder through a symbolic link/);
    symlinkSync(outside, join(root, ".getframes"), "dir");
    await expect(writeFileInside(root, join(root, ".getframes", "activity.json"), "[]")).rejects.toThrow(/\.getframes leads outside the project folder through a symbolic link/);
    // the new file made there is gone again
    expect(readdirSync(outside)).toEqual(["notes.json"]);
  });

  it.skipIf(process.platform === "win32")("refuses a named pipe instead of waiting for a writer", { timeout: 2_000 }, async () => {
    const { root } = folders();
    mkdirSync(join(root, ".getframes"));
    execFileSync("mkfifo", [join(root, ".getframes", "activity.json")]);
    await expect(readFileInside(root, join(root, ".getframes", "activity.json"))).rejects.toThrow(/is not a regular file/);
  });
});

describe("a folder switched for a link while writeFileInside works", () => {
  /** A project with its app folder, and a folder outside it with a file of the user's under the same name. */
  function folders() {
    const root = mkdtempSync(join(tmpdir(), "guard-project-"));
    mkdirSync(join(root, ".getframes"));
    writeFileSync(join(root, ".getframes", "activity.json"), "[]");
    const outside = mkdtempSync(join(tmpdir(), "guard-outside-"));
    writeFileSync(join(outside, "activity.json"), "theirs");
    const out = () => {
      renameSync(join(root, ".getframes"), join(root, ".getframes-real"));
      symlinkSync(outside, join(root, ".getframes"), "dir");
    };
    const back = () => {
      unlinkSync(join(root, ".getframes"));
      renameSync(join(root, ".getframes-real"), join(root, ".getframes"));
    };
    return { root, outside, out, back };
  }

  it.skipIf(!canSymlink)("after the check: the rename finds no new file there and replaces nothing", async () => {
    const { root, outside, out } = folders();
    between.rename = out;
    await expect(writeFileInside(root, join(root, ".getframes", "activity.json"), "[1]")).rejects.toThrow(/ENOENT/);
    expect(readFileSync(join(outside, "activity.json"), "utf8")).toBe("theirs");
    expect(readdirSync(outside)).toEqual(["activity.json"]);
  });

  // a hard link to a file in another folder, and folders renamed with links in them: not on Windows
  it.skipIf(!canSymlink || process.platform === "win32")("around the check, with another name made for the new file: refused before anything is written", async () => {
    const { root, outside, out, back } = folders();
    // the folder leads outside when the new file is made (after the first check), then back inside with a hard link to it, then outside again for the rename
    between.opening = out;
    between.made = (tmp) => {
      back();
      linkSync(join(outside, basename(tmp)), join(root, ".getframes", basename(tmp)));
      between.rename = out;
    };
    await expect(writeFileInside(root, join(root, ".getframes", "activity.json"), "[1]")).rejects.toThrow(/\.getframes leads outside the project folder/);
    expect(readFileSync(join(outside, "activity.json"), "utf8")).toBe("theirs");
    between.rename = undefined;
  });
});

describe("links resolved one at a time", () => {
  it.skipIf(!canSymlink)("follows a link that stays inside: relative, or absolute under the project's path", () => {
    const { root } = folders();
    mkdirSync(join(root, "sources"));
    writeFileSync(join(root, "sources", "photo.jpg"), "photo");
    mkdirSync(join(root, "short"));
    symlinkSync(join("..", "sources"), join(root, "short", "sources"), "dir");
    symlinkSync(join(root, "sources", "photo.jpg"), join(root, "given.jpg"));
    const photo = join(realpathSync(root), "sources", "photo.jpg");
    for (const p of [join(root, "short", "sources", "photo.jpg"), join(root, "given.jpg")]) {
      expect(resolveInside(root, p)).toEqual({ real: photo, missing: false });
      expect(lookInside(root, p)?.real).toBe(photo);
      expect(readTextInside(root, p)).toBe("photo");
    }
    // not made yet: inside, where it would be
    expect(isInside(root, "short/sources/new.jpg")).toBe(true);
    expect(lookInside(root, join(root, "short", "sources", "new.jpg"))).toBeUndefined();
  });

  it.skipIf(!canSymlink)("never looks up a target outside: absolute, climbing out, through a link on the way, or a loop", async () => {
    const { root, outside } = folders();
    symlinkSync(join(outside, "notes.json"), join(root, "out.json"));
    symlinkSync(join("..", basename(outside), "notes.json"), join(root, "up.json"));
    // "sub/../notes.json": sub's parent, outside, not the project
    mkdirSync(join(outside, "deep"));
    symlinkSync(join(outside, "deep"), join(root, "sub"), "dir");
    symlinkSync(["sub", "..", "notes.json"].join(sep), join(root, "via.json"));
    // each the other's target
    symlinkSync("b", join(root, "a"));
    symlinkSync("a", join(root, "b"));
    const out = await followedOut(root, async () => {
      for (const name of ["out.json", "up.json", "via.json", "a", join("sub", "x.json")]) {
        expect(resolveInside(root, join(root, name))).toBeUndefined();
        expect(isInside(root, name)).toBe(false);
        expect(lookInside(root, join(root, name))).toBeUndefined();
        expect(readTextInside(root, join(root, name))).toBeUndefined();
        await expect(readFileInside(root, join(root, name))).rejects.toThrow(/leads outside the project folder through a symbolic link/);
      }
      await expect(writeFileInside(root, join(root, "sub", "x.json"), "{}")).rejects.toThrow(/sub leads outside the project folder/);
    });
    expect(out).toEqual([]);
    expect(readdirSync(join(outside, "deep"))).toEqual([]);
  });
});
