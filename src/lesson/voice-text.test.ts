import { describe, it, expect } from "vitest";
import { parseVoice, interpretCue, parseLineSpec } from "./voice-text.js";

describe("parseVoice", () => {
  it("strips cue markers and records where each cue lands", () => {
    const v = parseVoice("Đầu tiên {1}là cache, sau đó {2}gọi API.");
    expect(v.segments).toHaveLength(1);
    const seg = v.segments[0];
    expect(seg.text).toBe("Đầu tiên là cache, sau đó gọi API.");
    expect(seg.cues.map((c) => c.name)).toEqual(["1", "2"]);
    expect(seg.text.slice(seg.cues[0].offset)).toMatch(/^là cache/);
    expect(seg.text.slice(seg.cues[1].offset)).toMatch(/^gọi API/);
    expect(v.display).toBe(seg.text);
  });

  it("splits the narration at {pause:N} into segments with silence", () => {
    const v = parseVoice("Interface nằm ở đâu? {pause:4} {answer}Ở Domain.");
    expect(v.segments.map((s) => s.text)).toEqual(["Interface nằm ở đâu?", "Ở Domain."]);
    expect(v.segments[0].pauseAfter).toBe(4);
    expect(v.segments[1].cues).toEqual([{ name: "answer", offset: 0 }]);
    expect(v.display).toBe("Interface nằm ở đâu? Ở Domain.");
  });

  it("keeps braces that are not markers as literal text", () => {
    const v = parseVoice("Viết {một đoạn bất kỳ} vào đây");
    expect(v.segments[0].text).toBe("Viết {một đoạn bất kỳ} vào đây");
    expect(v.segments[0].cues).toEqual([]);
  });

  it("clamps long pauses and folds a trailing empty segment into the previous one", () => {
    const v = parseVoice("Xong rồi. {pause:30}");
    expect(v.segments).toHaveLength(1);
    expect(v.segments[0].pauseAfter).toBe(12);
    expect(parseVoice("A {pause} B").segments[0].pauseAfter).toBe(1);
  });

  it("collapses whitespace left behind by markers", () => {
    const v = parseVoice("Một  {1} hai\n{2}ba");
    expect(v.segments[0].text).toBe("Một hai ba");
  });
});

describe("interpretCue", () => {
  it("understands every cue family", () => {
    expect(interpretCue("3")).toEqual({ kind: "item", index: 3 });
    expect(interpretCue("L3-5")).toEqual({ kind: "lines", lines: [3, 4, 5] });
    expect(interpretCue("L2,7-8")).toEqual({ kind: "lines", lines: [2, 7, 8] });
    expect(interpretCue("answer")).toEqual({ kind: "answer" });
    expect(interpretCue("flow:app>repo>db")).toEqual({ kind: "action", verb: "flow", arg: "app>repo>db" });
    expect(interpretCue("hl:repo")).toEqual({ kind: "action", verb: "hl", arg: "repo" });
    expect(interpretCue("tap:2")).toEqual({ kind: "action", verb: "tap", arg: "2" });
    expect(interpretCue("cache")).toEqual({ kind: "named", name: "cache" });
    expect(interpretCue("foo:bar")).toEqual({ kind: "named", name: "foo:bar" });
  });
});

describe("parseLineSpec", () => {
  it("expands ranges, sorts and de-duplicates", () => {
    expect(parseLineSpec("8,3-5,4")).toEqual([3, 4, 5, 8]);
    expect(parseLineSpec("5-3")).toEqual([3, 4, 5]);
    expect(parseLineSpec("x")).toEqual([]);
  });
});
