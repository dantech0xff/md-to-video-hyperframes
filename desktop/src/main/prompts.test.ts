import { describe, it, expect } from "vitest";
import type { ProjectFile } from "../shared/types";
import { videoTargets } from "./projects";
import { agentsMd, firstPrompt, notesPrompt, SKILL } from "./prompts";

const project: ProjectFile = {
  version: 1,
  title: "Repository pattern trong Android",
  kind: "lesson",
  request: { topic: "Repository pattern trong Android", notes: "Khán giả mới học Kotlin.\nNhấn mạnh test.", style: "blueprint", voice: "free" },
  sources: [
    { file: "sources/notes.md", origin: "text" },
    { file: "sources/android-guide.md", origin: "url", url: "https://developer.android.com/topic/architecture/data-layer" },
  ],
  agent: { id: "claude-code" },
  createdAt: "2026-09-25T08:00:00Z",
  updatedAt: "2026-09-25T08:00:00Z",
};

describe("prompts", () => {
  it("asks for a lesson and its Short, with the user's choices and material", () => {
    const text = firstPrompt(project, videoTargets("lesson"));
    expect(text).toContain(`Làm theo skill \`${SKILL}\`, phần "App mode (Get Frames)".`);
    expect(text).toContain("- Chủ đề: Repository pattern trong Android");
    expect(text).toContain('`script.json`: bài giảng YouTube 16:9 (`"formats": ["landscape"]`). Bộ file đăng bài: `youtube.md` với các mục "## Tiêu đề", "## Mô tả", "## Tags", "## Thumbnail".');
    expect(text).toContain('`short/script.json`: Short 9:16 riêng (`"formats": ["portrait"]`, `"intro": "none"`, 45–90 giây). Bộ file đăng bài: `short/youtube.md` với các mục "## Tiêu đề", "## Caption", "## Hashtags", "## Thumbnail".');
    expect(text).toContain("- Style: style `blueprint`.");
    expect(text).toContain('- Giọng đọc: giọng free (Edge TTS): `"voice": { "profile": "free" }`.');
    expect(text).toContain("  Khán giả mới học Kotlin.\n  Nhấn mạnh test.");
    expect(text).toContain("- `sources/android-guide.md` (tải từ https://developer.android.com/topic/architecture/data-layer)");
    expect(text).toContain("Không render.");
  });

  it("lets the agent choose the style and outline without material", () => {
    const text = firstPrompt({ ...project, kind: "short", request: { ...project.request, style: "", notes: "", voice: "clone" }, sources: [] }, videoTargets("short"));
    expect(text).toContain("tự chọn style hợp với nội dung");
    expect(text).toContain('`"voice": { "profile": "clone" }`');
    expect(text).toContain("Không có tư liệu");
    expect(text).not.toContain("short/script.json");
    expect(text).not.toContain("Ghi chú của người dùng");
  });

  it("turns review notes into a revision request", () => {
    const [main] = videoTargets("lesson");
    const text = notesPrompt(
      { video: "main", format: "landscape", general: "Nói chậm lại một chút", scenes: [{ key: "impl", note: "Code dài quá" }, { key: "hook", note: "  " }] },
      main,
    );
    expect(text).toBe(
      "Ghi chú của người dùng sau khi xem storyboard Bài giảng 16:9 (`script.json`, landscape):\n" +
        "- Cảnh `impl`: Code dài quá\n" +
        "- Chung: Nói chậm lại một chút\n\n" +
        "Chỉ sửa những gì ghi chú yêu cầu, rồi chạy lại `validate_script` và `build_storyboard` cho `script.json`. Cập nhật `youtube.md` nếu chương thay đổi. Báo lại khi xong.",
    );
  });

  it("writes AGENTS.md for the project's videos", () => {
    const md = agentsMd({ kind: "short" }, videoTargets("short"));
    expect(md).toContain("Không chạy npm, node hay lệnh shell nào");
    expect(md).toContain('`script.json`: Short 9:16 riêng');
    expect(md).not.toContain("short/script.json");
  });
});
