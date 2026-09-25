import { describe, it, expect } from "vitest";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeReplaced, replacePath } from "./replace.js";

describe("replacePath", () => {
  it("replaces a file another program is reading, which keeps reading the old one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replace-"));
    await writeFile(join(dir, "video.mp4"), "last good video");
    await writeFile(join(dir, ".rendering-video.mp4"), "new video");
    // the app's player streaming the old video (on Windows, a file open elsewhere cannot be replaced)
    const player = await open(join(dir, "video.mp4"), "r");
    try {
      await replacePath(join(dir, ".rendering-video.mp4"), join(dir, "video.mp4"));
      expect(await readFile(join(dir, "video.mp4"), "utf8")).toBe("new video");
      const { buffer, bytesRead } = await player.read(Buffer.alloc(64), 0, 64, 0);
      expect(buffer.subarray(0, bytesRead).toString()).toBe("last good video");
    } finally {
      await player.close();
    }
    await removeReplaced(dir);
    expect(await readdir(dir)).toEqual(["video.mp4"]);
  });

  it("replaces a folder, even one holding a file that is open", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replace-"));
    await mkdir(join(dir, "storyboard"));
    await writeFile(join(dir, "storyboard", "shot-001.png"), "old shot");
    await writeFile(join(dir, "storyboard", "shot-002.png"), "old shot");
    await mkdir(join(dir, "new"));
    await writeFile(join(dir, "new", "shot-001.png"), "new shot");
    const viewer = await open(join(dir, "storyboard", "shot-001.png"), "r");
    try {
      await replacePath(join(dir, "new"), join(dir, "storyboard"));
    } finally {
      await viewer.close();
    }
    expect(await readdir(join(dir, "storyboard"))).toEqual(["shot-001.png"]);
    expect(await readFile(join(dir, "storyboard", "shot-001.png"), "utf8")).toBe("new shot");
    await removeReplaced(dir);
    expect(await readdir(dir)).toEqual(["storyboard"]);
  });

  it("fills in a real folder where a link was, never writing through the link", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replace-"));
    const elsewhere = await mkdtemp(join(tmpdir(), "elsewhere-"));
    await writeFile(join(elsewhere, "keep.txt"), "not the render's");
    await symlink(elsewhere, join(dir, "fonts"), "junction");
    await mkdir(join(dir, "new"));
    await writeFile(join(dir, "new", "font.woff2"), "font");
    await replacePath(join(dir, "new"), join(dir, "fonts"));
    expect((await lstat(join(dir, "fonts"))).isDirectory()).toBe(true);
    expect(await readdir(join(dir, "fonts"))).toEqual(["font.woff2"]);
    expect(await readdir(elsewhere)).toEqual(["keep.txt"]);
  });

  it("moves a file where there was none, and fails without touching anything when the source is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replace-"));
    await writeFile(join(dir, "a.txt"), "a");
    await replacePath(join(dir, "a.txt"), join(dir, "b.txt"));
    expect(await readdir(dir)).toEqual(["b.txt"]);
    await expect(replacePath(join(dir, "missing.txt"), join(dir, "b.txt"))).rejects.toThrow(/ENOENT/);
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("a");
  });
});
