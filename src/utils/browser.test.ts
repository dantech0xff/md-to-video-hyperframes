import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hyperframesChromeBuild, installedChrome } from "./browser.js";

describe("Chrome for HyperFrames", () => {
  it("reads the build the locked HyperFrames CLI pins", () => {
    expect(hyperframesChromeBuild()).toBe("131.0.6778.85");
  });

  it("finds nothing in an empty download folder", async () => {
    expect(await installedChrome(await mkdtemp(join(tmpdir(), "browsers-")))).toBeUndefined();
  });
});
