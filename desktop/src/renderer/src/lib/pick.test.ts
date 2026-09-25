import { describe, it, expect } from "vitest";
import { shownFormat, shownVideo } from "./pick";

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
