import { describe, it, expect } from "vitest";
import { alignWords, timeAtOffset, estimateWordTimings, srtToWordTimings, charAlignmentToWords, edgeBoundariesToWords } from "./timing.js";

describe("alignWords / timeAtOffset", () => {
  const text = "Xin chào, Node.js rất nhanh!";
  const words = [
    { text: "Xin", start: 0, end: 0.2 },
    { text: "chào", start: 0.2, end: 0.5 },
    { text: "Node.js", start: 0.6, end: 1.0 },
    { text: "rất", start: 1.0, end: 1.2 },
    { text: "nhanh", start: 1.2, end: 1.6 },
  ];

  it("finds every word, including multi-token ones, ignoring punctuation", () => {
    const a = alignWords(text, words);
    expect(a.map((w) => text.slice(w.charStart, w.charEnd))).toEqual(["Xin", "chào", "Node.js", "rất", "nhanh"]);
  });

  it("does not match a word inside a longer word", () => {
    const a = alignWords("ban an", [{ text: "an", start: 0, end: 0.1 }]);
    expect(a[0].charStart).toBe(4);
  });

  it("turns a character offset into the start of the next spoken word", () => {
    const a = alignWords(text, words);
    expect(timeAtOffset(a, text.indexOf("rất"), 1.6)).toBe(1.0);
    expect(timeAtOffset(a, 0, 1.6)).toBe(0);
    expect(timeAtOffset(a, text.length, 1.6)).toBe(1.6);
  });
});

describe("timing sources", () => {
  it("estimates monotonic timings inside the duration", () => {
    const w = estimateWordTimings("Một hai, ba bốn. Năm", 3);
    expect(w).toHaveLength(5);
    expect(w[0].start).toBeCloseTo(0.08);
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeGreaterThanOrEqual(w[i - 1].end - 1e-9);
    expect(w[w.length - 1].end).toBeLessThanOrEqual(3);
  });

  it("splits SRT cues into words by length", () => {
    const w = srtToWordTimings("1\n00:00:00,000 --> 00:00:01,000\nXin chào\n\n2\n00:00:01,200 --> 00:00:02,000\nbạn\n");
    expect(w.map((x) => x.text)).toEqual(["Xin", "chào", "bạn"]);
    expect(w[0].end).toBeCloseTo(3 / 7);
    expect(w[2].start).toBeCloseTo(1.2);
    expect(w[2].end).toBeCloseTo(2.0);
  });

  it("groups ElevenLabs character alignment into words", () => {
    const w = charAlignmentToWords(["H", "i", " ", "b", "ạ", "n"], [0, 0.1, 0.2, 0.3, 0.4, 0.5], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(w).toEqual([
      { text: "Hi", start: 0, end: 0.2 },
      { text: "bạn", start: 0.3, end: 0.6 },
    ]);
  });

  it("converts Edge word boundaries from 100-ns ticks", () => {
    expect(edgeBoundariesToWords([{ offset: 5e6, duration: 2e6, text: "xin" }])).toEqual([{ text: "xin", start: 0.5, end: 0.7 }]);
  });
});
