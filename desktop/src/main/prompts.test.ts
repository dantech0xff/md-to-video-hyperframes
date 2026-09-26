import { describe, it, expect } from "vitest";
import type { ProjectFile } from "../shared/types";
import { videoTargets } from "./projects";
import { addEdit, agentsMd, editsNote, firstPrompt, notesPrompt, SKILL } from "./prompts";

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

  it("asks for a news brief told from the material, with sources named", () => {
    const news: ProjectFile = {
      ...project,
      kind: "news",
      title: "Android 17 beta đầu tiên mở cho Pixel",
      request: { ...project.request, style: "", notes: "" },
      sources: [
        { file: "sources/android-17-beta.md", origin: "url", url: "https://android-developers.googleblog.com/android-17-beta" },
        { file: "sources/pixel.JPG", origin: "file" },
      ],
    };
    const text = firstPrompt(news, videoTargets("news"));
    expect(text).toContain('`script.json`: bản tin 9:16 theo mục "News" ở bước 2 của skill (`"formats": ["portrait"]`, `"intro": "none"`, `"outro": { "enabled": false }`, 45–90 giây).');
    expect(text).toContain('Bộ file đăng bài: `youtube.md` với các mục "## Tiêu đề", "## Caption", "## Hashtags", "## Thumbnail".');
    expect(text).toContain("- Chỉ dùng thông tin có trong tư liệu. Mỗi con số, câu trích dẫn và nhận định ghi rõ nguồn; không thêm chi tiết từ trí nhớ.");
    expect(text).toContain("bản tin thường dùng `dantech-punch`");
    expect(text).toContain("- `sources/pixel.JPG` (ảnh: dùng được cho `image`, `media`, `avatar`)");
    expect(text).not.toContain("Không có tư liệu");
    // a lesson gets none of it
    expect(firstPrompt(project, videoTargets("lesson"))).not.toContain("Chỉ dùng thông tin có trong tư liệu");
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

  it("keeps what the user edited in the app once per part, and tells the agent", () => {
    let edited = addEdit(undefined, "script.json", "hook");
    edited = addEdit(edited, "short/script.json", "s2");
    edited = addEdit(edited, "script.json", "chapter-2");
    edited = addEdit(edited, "script.json", "hook");
    expect(edited).toEqual({ "script.json": ["hook", "chapter-2"], "short/script.json": ["s2"] });
    expect(editsNote(edited)).toBe(
      "(Sau lượt trước của bạn, người dùng đã tự sửa trong app các phần sau (theo key cảnh như trong storyboard):\n" +
        "- `script.json`: `hook`, `chapter-2`\n" +
        "- `short/script.json`: `s2`\n" +
        "Đọc lại các file này trước khi sửa tiếp, và giữ những thay đổi đó trừ khi người dùng yêu cầu khác.)\n\n",
    );
    expect(editsNote({})).toBe("");
    expect(editsNote({ "script.json": [] })).toBe("");
  });

  it("writes AGENTS.md for the project's videos", () => {
    const md = agentsMd({ kind: "short" }, videoTargets("short"));
    expect(md).toContain("Không chạy npm, node hay lệnh shell nào");
    expect(md).toContain('`script.json`: Short 9:16 riêng');
    expect(md).not.toContain("short/script.json");
  });
});
