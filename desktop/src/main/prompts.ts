/**
 * What the app writes for the agent: AGENTS.md in every project, the first
 * message of a project and the messages that carry the user's review notes.
 * The skill holds the how-to; these texts say what this project wants.
 */
import { isImage } from "../shared/material";
import type { ProjectFile, ReviewNotes, SourceRef, VideoKind, VideoTarget } from "../shared/types";

export const SKILL = ".agents/skills/create-lesson-video/SKILL.md";

/** Sections of a publish kit, per video. The app shows each one with a copy button. */
export function publishKitSections(target: VideoTarget, kindOfVideo: VideoKind): string[] {
  return kindOfVideo === "lesson" && target.id === "main" ? ["Tiêu đề", "Mô tả", "Tags", "Thumbnail"] : ["Tiêu đề", "Caption", "Hashtags", "Thumbnail"];
}

function describeTarget(project: Pick<ProjectFile, "kind">, t: VideoTarget): string {
  const script =
    project.kind === "lesson" && t.id === "main"
      ? `\`${t.script}\`: bài giảng YouTube 16:9 (\`"formats": ["landscape"]\`)`
      : project.kind === "news"
        ? `\`${t.script}\`: bản tin 9:16 theo mục "News" ở bước 2 của skill (\`"formats": ["portrait"]\`, \`"intro": "none"\`, \`"outro": { "enabled": false }\`, 45–90 giây)`
        : `\`${t.script}\`: Short 9:16 riêng (\`"formats": ["portrait"]\`, \`"intro": "none"\`, 45–90 giây)`;
  const sections = publishKitSections(t, project.kind).map((s) => `"## ${s}"`).join(", ");
  return `- ${script}. Bộ file đăng bài: \`${t.youtube}\` với các mục ${sections}.`;
}

export function agentsMd(project: Pick<ProjectFile, "kind">, targets: VideoTarget[]): string {
  return `# Dự án Get Frames

Thư mục này là một dự án video của app Get Frames. App tạo và ghi đè \`AGENTS.md\`,
\`CLAUDE.md\`, \`project.json\` và skill trong \`.agents/skills/\`, \`.claude/skills/\`:
đừng sửa các file đó.

- Làm theo skill \`${SKILL}\`, phần "App mode (Get Frames)".
- Tư liệu người dùng đưa nằm trong \`sources/\`. Không lên mạng nếu người dùng không yêu cầu.
- Dùng Studio tools (\`validate_script\`, \`check_layout\`, \`build_storyboard\`, \`wait_job\`,
  \`list_catalog\`). Không chạy npm, node hay lệnh shell nào. Không render: app render sau
  khi người dùng duyệt storyboard.
- Video trong dự án:
${targets.map((t) => describeTarget(project, t)).join("\n")}
- Trong bộ file đăng bài, mỗi mục là một heading \`##\` và chỉ chứa nội dung để dán thẳng
  lên YouTube: người dùng copy từng mục trong app.
`;
}

export const CLAUDE_MD = "@AGENTS.md\n";

function sourceList(sources: SourceRef[]): string {
  if (!sources.length) return "- Không có tư liệu: tự lên dàn ý từ chủ đề, chính xác và theo API ổn định hiện hành.";
  return sources.map((s) => `- \`${s.file}\`${isImage(s.file) ? " (ảnh: dùng được cho `image`, `media`, `avatar`)" : ""}${s.url ? ` (tải từ ${s.url})` : ""}`).join("\n");
}

/** The first message of a project. */
export function firstPrompt(project: ProjectFile, targets: VideoTarget[]): string {
  const r = project.request;
  const news = project.kind === "news";
  const style = r.style ? `style \`${r.style}\`` : `tự chọn style hợp với nội dung (xem \`list_catalog\`${news ? "; bản tin thường dùng `dantech-punch`" : ""})`;
  const voice = r.voice === "clone" ? `giọng clone: \`"voice": { "profile": "clone" }\`` : `giọng free (Edge TTS): \`"voice": { "profile": "free" }\``;
  return `Bạn đang chạy trong app Get Frames, trong thư mục dự án này.
Làm theo skill \`${SKILL}\`, phần "App mode (Get Frames)".

Yêu cầu:
- Chủ đề: ${project.title}
${targets.map((t) => describeTarget(project, t)).join("\n")}
- Style: ${style}.
- Giọng đọc: ${voice}.
${news ? "- Chỉ dùng thông tin có trong tư liệu. Mỗi con số, câu trích dẫn và nhận định ghi rõ nguồn; không thêm chi tiết từ trí nhớ.\n" : ""}${r.notes.trim() ? `- Ghi chú của người dùng:\n${indent(r.notes.trim())}\n` : ""}
Tư liệu (đọc trước khi viết):
${sourceList(project.sources)}

Dùng Studio tools để kiểm tra và dựng storyboard. Không render.
Dừng khi storyboard của mọi video hết lỗi và đã viết đủ bộ file đăng bài. Cuối cùng báo ngắn gọn thời lượng từng video và các cảnh báo không sửa được.`;
}

/** The user's review notes as a message for the agent. */
export function notesPrompt(notes: ReviewNotes, target: VideoTarget): string {
  const lines = [
    ...notes.scenes.filter((s) => s.note.trim()).map((s) => `- Cảnh \`${s.key}\`: ${s.note.trim()}`),
    ...(notes.general.trim() ? [`- Chung: ${notes.general.trim()}`] : []),
  ];
  return `Ghi chú của người dùng sau khi xem storyboard ${target.label} (\`${target.script}\`, ${notes.format}):
${lines.join("\n")}

Chỉ sửa những gì ghi chú yêu cầu, rồi chạy lại \`validate_script\` và \`build_storyboard\` cho \`${target.script}\`. Cập nhật \`${target.youtube}\` nếu chương thay đổi. Báo lại khi xong.`;
}

/** Records that the user edited a part of a script in the app (its storyboard key), once per part. */
export function addEdit(edited: Record<string, string[]> | undefined, script: string, key: string): Record<string, string[]> {
  const keys = edited?.[script] ?? [];
  return { ...edited, [script]: keys.includes(key) ? keys : [...keys, key] };
}

/**
 * Prefix for the agent's next message after the user edited scripts in the
 * app: the agent's view of those files is out of date, and writing from it
 * would undo the user's changes.
 */
export function editsNote(edited: Record<string, string[]>): string {
  const lines = Object.entries(edited)
    .filter(([, keys]) => keys.length)
    .map(([script, keys]) => `- \`${script}\`: ${keys.map((k) => `\`${k}\``).join(", ")}`);
  if (!lines.length) return "";
  return `(Sau lượt trước của bạn, người dùng đã tự sửa trong app các phần sau (theo key cảnh như trong storyboard):
${lines.join("\n")}
Đọc lại các file này trước khi sửa tiếp, và giữ những thay đổi đó trừ khi người dùng yêu cầu khác.)

`;
}

/** Prefix for a message when the earlier agent session could not be reopened. */
export const FRESH_SESSION_NOTE =
  "(Phiên làm việc trước không mở lại được. Đọc project.json, các script.json và bộ file đăng bài hiện có để nắm việc đã làm.)\n\n";

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `  ${l}`)
    .join("\n");
}
