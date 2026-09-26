import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useAsset, type Ctx } from "./compose-kit.js";
import { loadStyle } from "./styles.js";

/** A project folder with a photo in sources/, and a file outside it. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), "assets-project-"));
  mkdirSync(join(dir, "sources"));
  writeFileSync(join(dir, "sources", "photo.jpg"), "photo");
  const outside = mkdtempSync(join(tmpdir(), "assets-outside-"));
  writeFileSync(join(outside, "secret.txt"), "secret");
  return { dir, outside };
}

/** The render context useAsset reads, for a script in `scriptDir`. */
const ctx = (scriptDir: string, assetRoot?: string) => ({ scriptDir, outDir: join(scriptDir, "portrait"), assets: new Map(), assetRoot }) as unknown as Ctx;

const canSymlink = (() => {
  try {
    const d = mkdtempSync(join(tmpdir(), "link-"));
    symlinkSync(d, join(d, "self"), "dir");
    return true;
  } catch {
    return false;
  }
})();

describe("script images", () => {
  it("copies a file next to the script into the format folder", async () => {
    const { dir } = project();
    const rel = await useAsset(ctx(dir), "sources/photo.jpg");
    expect(rel).toMatch(/^media\/1-photo\.jpg$/);
    expect(readFileSync(join(dir, "portrait", rel), "utf8")).toBe("photo");
  });

  it("takes any file in the project when the script comes from an agent, a Short's included", async () => {
    const { dir } = project();
    mkdirSync(join(dir, "short"));
    const rel = await useAsset(ctx(join(dir, "short"), dir), "../sources/photo.jpg");
    expect(readFileSync(join(dir, "short", "portrait", rel), "utf8")).toBe("photo");
  });

  it("refuses a file outside the project, and links, when the script comes from an agent", async () => {
    const { dir, outside } = project();
    const agent = ctx(dir, dir);
    await expect(useAsset(agent, join(outside, "secret.txt"))).rejects.toThrow(/outside the project folder/);
    await expect(useAsset(agent, "../" + outside.split(/[\\/]/).pop() + "/secret.txt")).rejects.toThrow(/outside the project folder/);
    // the engine would fetch these: the network, without asking the user
    await expect(useAsset(agent, "https://example.com/photo.jpg")).rejects.toThrow(/is a link/);
    await expect(useAsset(agent, "file:///etc/hostname")).rejects.toThrow(/is a link/);
    expect(existsSync(join(dir, "portrait", "media"))).toBe(false);
  });

  it.skipIf(!canSymlink)("refuses a link inside the project that leads out of it", async () => {
    const { dir, outside } = project();
    symlinkSync(join(outside, "secret.txt"), join(dir, "sources", "innocent.jpg"));
    await expect(useAsset(ctx(dir, dir), "sources/innocent.jpg")).rejects.toThrow(/through a symbolic link/);
  });

  it.skipIf(!canSymlink)("copies the file it checked, not one a link was switched to after the check", async () => {
    const { dir, outside } = project();
    const link = join(dir, "sources", "switch.jpg");
    symlinkSync(join(dir, "sources", "photo.jpg"), link);
    // useAsset checks the link, then waits on the output folder before copying: another process switches the link meanwhile
    const copy = useAsset(ctx(dir, dir), "sources/switch.jpg");
    unlinkSync(link);
    symlinkSync(join(outside, "secret.txt"), link);
    await expect(copy).rejects.toThrow(/through a symbolic link/);
    expect(existsSync(join(dir, "portrait", "media", "1-switch.jpg"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("refuses a named pipe instead of waiting for a writer", { timeout: 2_000 }, async () => {
    const { dir } = project();
    execFileSync("mkfifo", [join(dir, "sources", "pipe.jpg")]);
    await expect(useAsset(ctx(dir, dir), "sources/pipe.jpg")).rejects.toThrow(/is not a regular file/);
  });

  it.skipIf(process.platform === "win32" || !canSymlink)("refuses a pipe that a link was switched to after the check", { timeout: 2_000 }, async () => {
    const { dir, outside } = project();
    execFileSync("mkfifo", [join(outside, "pipe")]);
    const link = join(dir, "sources", "switch.jpg");
    symlinkSync(join(dir, "sources", "photo.jpg"), link);
    const copy = useAsset(ctx(dir, dir), "sources/switch.jpg");
    unlinkSync(link);
    symlinkSync(join(outside, "pipe"), link);
    await expect(copy).rejects.toThrow(/is not a regular file/);
  });

  it.skipIf(!canSymlink)("refuses an output folder that leads out of the project, before making anything there", async () => {
    const { dir, outside } = project();
    symlinkSync(outside, join(dir, "portrait"), "dir");
    await expect(useAsset(ctx(dir, dir), "sources/photo.jpg")).rejects.toThrow(/portrait[\\/]media leads outside the project folder through a symbolic link/);
    expect(readdirSync(outside)).toEqual(["secret.txt"]);
  });

  // switching a link to a folder in one step (a rename over it) is not something Windows does
  it.skipIf(!canSymlink || process.platform === "win32")("writes nothing through an output folder switched for a link after the check", async () => {
    const { dir, outside } = project();
    // the format folder is a link that stays in the project when useAsset checks it
    mkdirSync(join(dir, "real", "media"), { recursive: true });
    symlinkSync(join(dir, "real"), join(dir, "portrait"), "dir");
    mkdirSync(join(outside, "media"));
    symlinkSync(outside, join(dir, "portrait.next"), "dir");
    // useAsset checks the output folder, then waits on it before writing: another process switches it meanwhile
    const copy = useAsset(ctx(dir, dir), "sources/photo.jpg");
    renameSync(join(dir, "portrait.next"), join(dir, "portrait"));
    await expect(copy).rejects.toThrow(/portrait[\\/]media leads outside the project folder through a symbolic link/);
    // no image and no file named after it: the new file made there was removed
    expect(readdirSync(join(outside, "media"))).toEqual([]);
    expect(readdirSync(join(dir, "real", "media"))).toEqual([]);
  });
});

describe("style ids", () => {
  it("names a style pack, never a path", () => {
    expect(loadStyle("dantech").id).toBe("dantech");
    expect(() => loadStyle("../../../tmp/x")).toThrow(/Invalid style id/);
  });
});
