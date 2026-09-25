import type { AgentState, ProjectStage, RenderStatus } from "../../../shared/types";

/** 75.4 → "1:15" */
export function clock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "–";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** "vừa xong", "5 phút trước", "3 giờ trước", then the date */
export function ago(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export const STAGE_LABEL: Record<ProjectStage, string> = {
  new: "Mới tạo",
  writing: "Đang viết kịch bản",
  review: "Chờ duyệt storyboard",
  rendered: "Đã render",
};

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  idle: "Agent rảnh",
  working: "Agent đang làm",
  waiting: "Agent chờ bạn",
  error: "Agent gặp lỗi",
};

export const RENDER_STATUS_LABEL: Record<RenderStatus, string> = {
  queued: "Đang chờ",
  running: "Đang render",
  done: "Xong",
  failed: "Lỗi",
  cancelled: "Đã huỷ",
};

export const QUALITY_LABEL = { draft: "Nháp (nhanh)", standard: "Chuẩn", high: "Cao (chậm)" } as const;

export const FORMAT_LABEL = { landscape: "16:9", portrait: "9:16" } as const;
