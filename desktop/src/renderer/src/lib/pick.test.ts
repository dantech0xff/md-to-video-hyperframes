import { describe, it, expect } from "vitest";
import { buildBanner, emptiesChapter, isChapterEnd, newVideoAgent, newVideoVoice, notesAfter, reviewFor, shownFormat, shownVideo, videoBuild } from "./pick";

describe("storyboard part changes", () => {
  // a landscape review: the sting plays after the cold open, inside the first chapter
  const rows = [
    { kind: "scene" as const, chapterIndex: 0 },
    { kind: "intro" as const, chapterIndex: 0 },
    { kind: "chapter" as const, chapterIndex: 1 },
    { kind: "scene" as const, chapterIndex: 1 },
    { kind: "scene" as const, chapterIndex: 1 },
    { kind: "outro" as const, chapterIndex: 1 },
  ];

  it("puts a chapter's add strip after its last scene, the intro in between or not", () => {
    expect(rows.map((_, i) => isChapterEnd(rows, i))).toEqual([true, false, false, false, true, false]);
  });

  it("tells a scene that is its chapter's only one", () => {
    expect(rows.map((_, i) => emptiesChapter(rows, i))).toEqual([true, false, false, false, false, false]);
  });

  it("keeps notes on the parts they were written for, in every format of the video", () => {
    const book = {
      "main:landscape": { general: "g", scenes: { hook: "a", s3: "b", "chapter-2": "c", s5: "gone" } },
      "main:portrait": { general: "", scenes: { s3: "b2" } },
      "short:portrait": { general: "", scenes: { s3: "another video's" } },
    };
    const after = notesAfter(book, "main", { s3: "s4", "chapter-1": "chapter-2", "chapter-2": "chapter-1", s5: null });
    expect(after["main:landscape"]).toEqual({ general: "g", scenes: { hook: "a", s4: "b", "chapter-1": "c" } });
    expect(after["main:portrait"].scenes).toEqual({ s4: "b2" });
    expect(after["short:portrait"]).toBe(book["short:portrait"]);
    // two parts that traded places trade notes: neither is lost
    expect(notesAfter({ "main:landscape": { general: "", scenes: { s1: "x", s2: "y" } } }, "main", { s1: "s2", s2: "s1" })["main:landscape"].scenes).toEqual({ s1: "y", s2: "x" });
    // nothing moved: the same book
    expect(notesAfter(book, "main", undefined)).toBe(book);
    // a scene named like an object's member is a key like any other
    expect(notesAfter({ "main:landscape": { general: "", scenes: { constructor: "n" } } }, "main", { s1: "s2" })["main:landscape"].scenes).toEqual({ constructor: "n" });
  });
});

describe("storyboard selection", () => {
  it("shows a video that has a script, even when the lesson's Short came first", () => {
    const shortOnly = [
      { id: "main" as const, exists: false },
      { id: "short" as const, exists: true },
    ];
    expect(shownVideo(shortOnly, "main")).toBe("short");
    expect(shownVideo([{ id: "main", exists: true }, { id: "short", exists: true }], "short")).toBe("short");
    expect(shownVideo([{ id: "main", exists: false }], "main")).toBe("main");
  });

  it("keeps the picked format only when the video has it", () => {
    const portraitOnly = { formats: [{ format: "portrait" as const, videoStale: false }] };
    expect(shownFormat(portraitOnly, "landscape")).toBe("portrait");
    expect(shownFormat({ formats: [{ format: "landscape", videoStale: false }, { format: "portrait", videoStale: false }] }, "portrait")).toBe("portrait");
  });

  it("offers to build again after a failure, a stop, or when the storyboard is out of date", () => {
    const current = { stale: false, storyboard: "/p/portrait/storyboard.jpg" };
    const none = { stale: false };
    expect(buildBanner({ status: "running" }, current)).toBe("building");
    expect(buildBanner({ status: "queued" }, none)).toBe("building");
    expect(buildBanner({ status: "failed" }, none)).toBe("failed");
    expect(buildBanner({ status: "failed" }, { ...current, stale: true })).toBe("failed");
    // the review not loaded yet: the failure stays
    expect(buildBanner({ status: "failed" }, undefined)).toBe("failed");
    // failed, and the storyboard is current since (the agent built it): nothing to say
    expect(buildBanner({ status: "failed" }, current)).toBeUndefined();
    // stopped before the video had a storyboard: nothing else would offer to build it
    expect(buildBanner({ status: "cancelled" }, none)).toBe("stopped");
    expect(buildBanner({ status: "cancelled" }, { ...current, stale: true })).toBe("stopped");
    // stopped, and the storyboard is current since (the agent built it): nothing to say
    expect(buildBanner({ status: "cancelled" }, current)).toBeUndefined();
    expect(buildBanner({ status: "done" }, { ...current, stale: true })).toBe("stale");
    expect(buildBanner(undefined, current)).toBeUndefined();
    expect(buildBanner(undefined, undefined)).toBeUndefined();
  });

  it("shows the scenes of the video and format picked, never another's still on screen while theirs load", () => {
    const lesson = { video: "main" as const, format: "landscape" as const, scenes: ["hook"] };
    expect(reviewFor(lesson, "main", "landscape")).toBe(lesson);
    // the Short was just picked: the lesson's hook must not open the Short's
    expect(reviewFor(lesson, "short", "landscape")).toBeUndefined();
    expect(reviewFor(lesson, "main", "portrait")).toBeUndefined();
    expect(reviewFor(undefined, "main", "landscape")).toBeUndefined();
  });

  it("shows the project's own build of the video, the latest one the screen heard of first", () => {
    const job = (id: string, projectId: string, video: "main" | "short", status: "running" | "done") => ({ id, projectId, video, status });
    const listed = [job("b1", "p1", "main", "done"), job("b2", "p1", "short", "running")];
    expect(videoBuild([], listed, "p1", "main")?.id).toBe("b1");
    expect(videoBuild([job("b3", "p1", "main", "running")], listed, "p1", "main")?.id).toBe("b3");
    // another project's build of its main video is not this one's
    expect(videoBuild([job("x1", "p2", "main", "running")], listed, "p1", "main")?.id).toBe("b1");
    expect(videoBuild([job("x1", "p2", "main", "running")], undefined, "p1", "main")).toBeUndefined();
  });
});

describe("a new video's voice", () => {
  const voices = (fallback: "free" | "clone", cloneReady: boolean) => ({
    default: fallback,
    free: { available: true, provider: "edge-tts", voice: "vi-VN-HoaiMyNeural" },
    clone: { available: cloneReady, provider: "elevenlabs" },
  });

  it("starts from the default saved in Settings", () => {
    expect(newVideoVoice(undefined, voices("clone", true))).toBe("clone");
    expect(newVideoVoice(undefined, voices("free", true))).toBe("free");
  });

  it("keeps the user's pick for this video", () => {
    expect(newVideoVoice("free", voices("clone", true))).toBe("free");
    expect(newVideoVoice("clone", voices("free", true))).toBe("clone");
  });

  it("uses the free voice when the saved clone voice has no key yet", () => {
    expect(newVideoVoice(undefined, voices("clone", false))).toBe("free");
    expect(newVideoVoice(undefined, undefined)).toBe("free");
  });
});

describe("a new video's agent", () => {
  const agents = (...installed: ("claude-code" | "codex" | "devin")[]) => (["claude-code", "codex", "devin"] as const).map((id) => ({ id, installed: installed.includes(id) }));

  it("starts from the default saved in Settings when it is installed", () => {
    expect(newVideoAgent(undefined, agents("claude-code", "codex"), "codex")).toBe("codex");
    expect(newVideoAgent(undefined, agents("claude-code", "codex"), "claude-code")).toBe("claude-code");
  });

  it("falls back to an agent that is installed", () => {
    expect(newVideoAgent(undefined, agents("devin"), "claude-code")).toBe("devin");
    // none installed, or not checked yet: the default, and the screen says what is missing
    expect(newVideoAgent(undefined, agents(), "codex")).toBe("codex");
    expect(newVideoAgent(undefined, undefined, "codex")).toBe("codex");
  });

  it("keeps the user's pick for this video", () => {
    expect(newVideoAgent("devin", agents("claude-code", "devin"), "claude-code")).toBe("devin");
  });
});
