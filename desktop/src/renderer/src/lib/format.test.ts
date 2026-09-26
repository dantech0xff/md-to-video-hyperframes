import { describe, it, expect } from "vitest";
import { buildStage, clock } from "./format";

describe("format", () => {
  it("says what a storyboard build is doing", () => {
    expect(buildStage({ status: "queued" })).toMatch(/^chờ lượt/);
    expect(buildStage({ status: "running", step: "narration" })).toBe("đọc lời thoại");
    expect(buildStage({ status: "running", step: "narration", percent: 40 })).toBe("đọc lời thoại (40%)");
    expect(buildStage({ status: "running", step: "capture", format: "portrait" })).toBe("chụp khung hình 9:16");
  });

  it("writes durations as a clock", () => {
    expect(clock(75.4)).toBe("1:15");
    expect(clock(undefined)).toBe("–");
  });
});
