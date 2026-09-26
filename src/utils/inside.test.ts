import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertRealInside, within } from "./inside.js";

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
