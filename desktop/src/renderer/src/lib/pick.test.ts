import { describe, it, expect } from "vitest";
import { newVideoAgent, newVideoVoice, shownFormat, shownVideo } from "./pick";

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
