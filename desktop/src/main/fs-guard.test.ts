import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileInside, writeFileInside } from "./fs-guard";

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
