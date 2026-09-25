import { describe, it, expect } from "vitest";
import { buildEntries, buildTimeline, buildSfxEvents, buildCaptionGroups, unknownBeatCues } from "./plan.js";
import { loadStyle } from "./styles.js";
import { toSrt, toChapters } from "./exports.js";
import { fakeVoiceMap, lessonFixture } from "./test-utils.js";

const style = loadStyle("dantech");
const plan = (format: "landscape" | "portrait" = "landscape", script = lessonFixture()) => {
  const entries = buildEntries(script, format);
  return buildTimeline(entries, fakeVoiceMap(entries), style, format);
};

describe("buildEntries", () => {
  it("plays the cold open first, then the intro sting, chapter cards and outro (landscape)", () => {
    expect(buildEntries(lessonFixture(), "landscape").map((e) => e.key)).toEqual(["hook", "intro", "chapter-1", "list", "chapter-2", "code", "quiz", "outro"]);
  });

  it("skips the intro sting in portrait", () => {
    expect(buildEntries(lessonFixture(), "portrait").map((e) => e.key)).toEqual(["hook", "chapter-1", "list", "chapter-2", "code", "quiz", "outro"]);
  });

  it("honours intro: start / none and single-chapter lessons", () => {
    const s = lessonFixture();
    expect(buildEntries({ ...s, intro: "start" }, "landscape")[0].key).toBe("intro");
    expect(buildEntries({ ...s, intro: "none" }, "landscape").some((e) => e.kind === "intro")).toBe(false);
    const one = { ...s, chapters: [s.chapters[0]] };
    expect(buildEntries(one, "landscape").some((e) => e.kind === "chapter")).toBe(false);
  });
});

describe("buildTimeline", () => {
  const tl = plan();

  it("orders every scene on a consistent clock", () => {
    expect(tl.scenes[0].start).toBe(0);
    expect(tl.scenes[0].transition.type).toBe("none");
    tl.scenes.forEach((s, i) => {
      expect(s.start).toBeLessThanOrEqual(s.enterAt);
      expect(s.enterAt).toBeLessThanOrEqual(s.voiceStart);
      expect(s.voiceStart).toBeLessThanOrEqual(s.voiceEnd);
      expect(s.voiceEnd).toBeLessThanOrEqual(s.end);
      expect(s.until).toBeGreaterThanOrEqual(s.end);
      const next = tl.scenes[i + 1];
      if (next) {
        expect(next.start).toBeCloseTo(s.end);
        expect(s.until).toBeCloseTo(next.enterAt);
      }
    });
    expect(tl.duration).toBeCloseTo(tl.scenes[tl.scenes.length - 1].until);
  });

  it("turns cue markers into beats inside the narration", () => {
    const list = tl.scenes.find((s) => s.key === "list")!;
    const reveals = list.beats.filter((b) => b.do === "reveal");
    expect(reveals.map((b) => b.target)).toEqual([1, 2]);
    expect(reveals[0].t).toBeGreaterThanOrEqual(list.voiceStart);
    expect(reveals[1].t).toBeGreaterThan(reveals[0].t);
    expect(reveals[1].t).toBeLessThanOrEqual(list.voiceEnd);

    const code = tl.scenes.find((s) => s.key === "code")!;
    const focus = code.beats.filter((b) => b.do === "focus");
    expect(focus.map((b) => b.lines)).toEqual([[2], [3]]);
    expect(focus[1].note).toBe("trả về");
    expect(unknownBeatCues(code.spec!, code.cues)).toEqual([]);
    expect(unknownBeatCues({ ...code.spec!, beats: [{ at: "missing", do: "focus" }] } as never, code.cues)).toEqual(["missing"]);
  });

  it("inserts pauses and reveals the quiz answer after them", () => {
    const quiz = tl.scenes.find((s) => s.key === "quiz")!;
    expect(quiz.pauses).toHaveLength(1);
    expect(quiz.pauses[0].end - quiz.pauses[0].start).toBeCloseTo(3);
    const answer = quiz.beats.find((b) => b.do === "answer")!;
    expect(answer.t).toBeGreaterThanOrEqual(quiz.pauses[0].end - 1e-6);
  });

  it("times caption words in display form", () => {
    const list = tl.scenes.find((s) => s.key === "list")!;
    expect(list.words.map((w) => w.text).join(" ")).toBe("Thứ nhất cache, thứ hai network.");
    for (let i = 1; i < list.words.length; i++) expect(list.words[i].start).toBeGreaterThanOrEqual(list.words[i - 1].start);
  });
});

describe("sound events and captions", () => {
  const tl = plan();

  it("places transition, intro, typing and quiz sounds without crowding", () => {
    const ev = buildSfxEvents(tl);
    const kinds = new Set(ev.map((e) => e.event));
    for (const k of ["transition", "intro", "chapter", "type", "countdown", "correct", "outro"]) expect(kinds.has(k)).toBe(true);
    for (let i = 1; i < ev.length; i++) {
      expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t);
      if (!ev[i].name) expect(ev[i].t - ev[i - 1].t).toBeGreaterThanOrEqual(0.12 - 1e-9);
    }
  });

  it("groups captions without overlaps", () => {
    const groups = buildCaptionGroups(tl, 4);
    expect(groups.length).toBeGreaterThan(3);
    groups.forEach((g, i) => {
      expect(g.words.length).toBeLessThanOrEqual(4);
      if (groups[i + 1]) expect(g.end).toBeLessThanOrEqual(groups[i + 1].start + 1e-9);
    });
  });

  it("exports SRT and YouTube chapters", () => {
    expect(toSrt(tl)).toMatch(/^1\n00:00:00,\d{3} --> 00:00:\d{2},\d{3}\n/);
    const ch = toChapters(tl);
    expect(ch.startsWith("00:00 Mở đầu\n")).toBe(true);
    expect(ch).toContain("Phần 2: Thực hành");
  });
});
