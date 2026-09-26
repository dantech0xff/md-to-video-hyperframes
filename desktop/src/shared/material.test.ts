import { describe, it, expect } from "vitest";
import { hasTextMaterial, isImage } from "./material";

describe("material", () => {
  it("tells pictures by their file names", () => {
    expect(isImage("/Users/dan/Pictures/Photo.JPG")).toBe(true);
    expect(isImage("C:\\Users\\dan\\anh.webp")).toBe(true);
    expect(isImage("sources/bai-bao.pdf")).toBe(false);
    expect(isImage("/Users/dan/my.photos/readme")).toBe(false);
  });

  it("finds words to take facts from: a link, pasted text or a document, not pictures alone", () => {
    const none = { files: [] as string[], urls: [] as string[], text: "" };
    expect(hasTextMaterial(none)).toBe(false);
    expect(hasTextMaterial({ ...none, files: ["/Users/dan/Pictures/pixel.jpg", "/Users/dan/b.png"] })).toBe(false);
    expect(hasTextMaterial({ ...none, urls: ["  "], text: "\n" })).toBe(false);
    expect(hasTextMaterial({ ...none, files: ["/Users/dan/pixel.jpg", "/Users/dan/ban-tin.md"] })).toBe(true);
    expect(hasTextMaterial({ ...none, urls: ["https://android-developers.googleblog.com/x"] })).toBe(true);
    expect(hasTextMaterial({ ...none, text: "Android 17 beta mở cho Pixel." })).toBe(true);
  });
});
