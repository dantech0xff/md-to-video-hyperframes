import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
});

describe("style ids", () => {
  it("names a style pack, never a path", () => {
    expect(loadStyle("dantech").id).toBe("dantech");
    expect(() => loadStyle("../../../tmp/x")).toThrow(/Invalid style id/);
  });
});
