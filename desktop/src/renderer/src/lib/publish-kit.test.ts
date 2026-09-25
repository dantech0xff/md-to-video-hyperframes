import { describe, it, expect } from "vitest";
import { parsePublishKit } from "./publish-kit";

describe("parsePublishKit", () => {
  it("splits the sections the app asks the agent for", () => {
    const md = [
      "# Repository pattern",
      "",
      "## Tiêu đề",
      "Repository pattern: tách data layer đúng cách #Kotlin",
      "",
      "## Mô tả",
      "Tách nguồn dữ liệu khỏi UI.",
      "",
      "Trong video:",
      "0:00 Mở đầu",
      "1:05 Repository là gì",
      "",
      "https://dantech.academy",
      "",
      "## Tags",
      "kotlin, android, clean architecture",
      "",
    ].join("\n");
    expect(parsePublishKit(md)).toEqual([
      { label: "Tiêu đề", text: "Repository pattern: tách data layer đúng cách #Kotlin" },
      { label: "Mô tả", text: "Tách nguồn dữ liệu khỏi UI.\n\nTrong video:\n0:00 Mở đầu\n1:05 Repository là gì\n\nhttps://dantech.academy" },
      { label: "Tags", text: "kotlin, android, clean architecture" },
    ]);
  });

  it("reads the older bold-label style too", () => {
    const md = "# Coroutine (Shorts)\n\n**Tiêu đề:** launch hay async?\n\n**Caption:** Không cần kết quả thì dùng launch.\n\n**Hashtags:** #Kotlin #Coroutines\n";
    expect(parsePublishKit(md)).toEqual([
      { label: "Tiêu đề", text: "launch hay async?" },
      { label: "Caption", text: "Không cần kết quả thì dùng launch." },
      { label: "Hashtags", text: "#Kotlin #Coroutines" },
    ]);
  });

  it("keeps bold labels inside a heading's section as its text", () => {
    const md = "## Mô tả\nGiới thiệu Flow.\n**Bạn sẽ học:**\ncollect và emit\n\n## Tags\nkotlin";
    expect(parsePublishKit(md)).toEqual([
      { label: "Mô tả", text: "Giới thiệu Flow.\n**Bạn sẽ học:**\ncollect và emit" },
      { label: "Tags", text: "kotlin" },
    ]);
    // even as the first line of the section
    expect(parsePublishKit("## Mô tả\n**Bạn sẽ học:** collect")).toEqual([{ label: "Mô tả", text: "**Bạn sẽ học:** collect" }]);
  });

  it("drops empty sections and returns nothing for text without sections", () => {
    expect(parsePublishKit("## Tags\n\n## Thumbnail\nshot-001.png")).toEqual([{ label: "Thumbnail", text: "shot-001.png" }]);
    expect(parsePublishKit("Chỉ có một đoạn văn.")).toEqual([]);
  });
});
