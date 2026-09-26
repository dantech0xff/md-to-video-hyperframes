import { describe, it, expect } from "vitest";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLexicon, isBundledLexicon, loadLexicon } from "./lexicon.js";

const lex = { API: "ây pi ai", "Node.js": "nốt giây ét", Node: "nốt", UI: "iu ai" };

describe("applyLexicon", () => {
  it("replaces whole terms only, longest first", () => {
    const r = applyLexicon("Gọi API từ Node.js, không phải UIKit hay APIs.", lex);
    expect(r.text).toBe("Gọi ây pi ai từ nốt giây ét, không phải UIKit hay APIs.");
    expect(r.replacements).toBe(2);
  });

  it("maps offsets from the written text to the spoken text", () => {
    const src = "Gọi API rồi lưu vào Room";
    const r = applyLexicon(src, lex);
    expect(r.text.slice(r.mapOffset(src.indexOf("rồi")))).toMatch(/^rồi lưu/);
    expect(r.mapOffset(src.indexOf("API"))).toBe(r.text.indexOf("ây"));
    expect(r.mapOffset(0)).toBe(0);
    expect(r.mapOffset(src.length)).toBe(r.text.length);
  });

  it("is the identity without a lexicon", () => {
    const r = applyLexicon("Không đổi gì", null);
    expect(r.text).toBe("Không đổi gì");
    expect(r.mapOffset(4)).toBe(4);
    expect(r.replacements).toBe(0);
  });
});

describe("loadLexicon", () => {
  it("loads the bundled tech-vi lexicon without comment keys", () => {
    const l = loadLexicon("tech-vi");
    expect(l.API).toBeTruthy();
    expect(Object.keys(l).some((k) => k.startsWith("//"))).toBe(false);
  });
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

describe("isBundledLexicon", () => {
  it("takes the id of a lexicon file in the folder, never a path or a missing one", () => {
    expect(isBundledLexicon("tech-vi")).toBe(true);
    expect(isBundledLexicon("../../package")).toBe(false);
    expect(isBundledLexicon("no-such-lexicon")).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "lexicons-"));
    writeFileSync(join(dir, "mine.json"), "{}");
    expect(isBundledLexicon("mine", dir)).toBe(true);
  });

  it.skipIf(!canSymlink)("refuses a link in the folder that leads to a file elsewhere", () => {
    const dir = mkdtempSync(join(tmpdir(), "lexicons-"));
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.json"), "{}");
    symlinkSync(join(outside, "secret.json"), join(dir, "linked.json"));
    expect(isBundledLexicon("linked", dir)).toBe(false);
  });
});
