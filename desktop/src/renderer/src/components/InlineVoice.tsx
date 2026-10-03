/**
 * A part's narration editable right on its row — the same everywhere the
 * narration is listed (storyboard, the render screen's pre-TTS review). The
 * textarea holds the RAW voice text, cue markers {…} and all; they are
 * preserved on save.
 */
import { useState } from "react";
import { Check } from "lucide-react";
import type { StoryboardScene, VideoTarget } from "../../../shared/types";
import { invoke } from "../lib/api";
import { Spinner, useAction } from "./ui";

export function InlineVoice({ projectId, video, s, disabled, onConflict }: {
  projectId: string;
  video: VideoTarget["id"];
  s: Pick<StoryboardScene, "key" | "voice">;
  /** agent is mid-turn: script edits wait for it */
  disabled?: boolean;
  /** the list this row belongs to, re-read when the script changed elsewhere */
  onConflict?: () => Promise<void>;
}) {
  const act = useAction();
  // the draft carries its video: a fetch started in one video must never be saved into another
  const [edit, setEdit] = useState<{ video: VideoTarget["id"]; fields: Record<string, unknown>; version: string; value: string } | undefined>();

  const open = () =>
    act.run(async () => {
      const part = await invoke("script:part", projectId, video, s.key);
      setEdit({ video, fields: part.value, version: part.version, value: typeof part.value.voice === "string" ? part.value.voice : "" });
    });
  const save = () =>
    act.run(async () => {
      if (!edit || edit.video !== video) return;
      const res = await invoke("script:save-part", projectId, video, { key: s.key, version: edit.version, value: { ...edit.fields, voice: edit.value } });
      if (res.ok) return setEdit(undefined);
      if (res.conflict) {
        setEdit(undefined);
        await onConflict?.();
        throw new Error("Kịch bản vừa đổi — đã tải lại, thử sửa lần nữa.");
      }
      // the draft stays open: fix it, or what the script has wrong elsewhere, and save again
      throw new Error([...res.errors, ...res.others].map((e) => e.message).join("; "));
    });

  const error = act.error instanceof Error ? act.error.message : typeof act.error === "string" ? act.error : undefined;
  if (edit?.video === video)
    return (
      <div className="stack tight">
        <textarea
          rows={3}
          autoFocus
          value={edit.value}
          disabled={act.busy}
          placeholder="Lời thoại của phần này…"
          onChange={(e) => setEdit({ ...edit, value: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && setEdit(undefined)}
        />
        <div className="row wrap">
          <button type="button" className="btn primary small" disabled={act.busy || disabled} onClick={() => void save()}>
            {act.busy ? <Spinner size={13} /> : <Check size={13} />} Lưu
          </button>
          <button type="button" className="btn small" onClick={() => setEdit(undefined)}>
            Huỷ
          </button>
          <span className="small faint">{"Các cue {…} giữ nguyên khi lưu"}</span>
        </div>
        {error && (
          <span className="small" style={{ color: "var(--danger)" }}>
            {error}
          </span>
        )}
      </div>
    );
  return (
    <>
      <button
        type="button"
        className="voice-line pre-wrap"
        disabled={disabled || act.busy}
        title={disabled ? "Agent đang làm việc: sửa khi agent xong lượt" : "Sửa lời thoại của phần này ngay tại đây, không cần agent"}
        onClick={() => void open()}
      >
        {s.voice || <span className="faint small">Không có lời thoại — bấm để thêm</span>}
      </button>
      {error && (
        <span className="small" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </>
  );
}
