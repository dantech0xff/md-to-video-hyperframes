import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readFileInside, writeFileInside } from "./fs-guard";

/** Another process at work between writeFileInside's steps: right after it makes its new file, and right before the rename. */
const between = vi.hoisted(() => ({ made: undefined as ((path: string) => void) | undefined, rename: undefined as (() => void) | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
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
    out();
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
