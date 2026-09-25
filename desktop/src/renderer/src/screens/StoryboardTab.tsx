/**
 * Storyboard review (design doc §3, step 4): every scene's frame, narration
 * and timing, with a note per scene; the notes go to the agent as one message.
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, ImageOff, MessageSquareText, RefreshCw, Send, TriangleAlert } from "lucide-react";
import type { FormatName, ProjectDetail, VideoTarget } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke } from "../lib/api";
import { clock, FORMAT_LABEL } from "../lib/format";
import { Banner, ErrorBanner, Spinner, useAction, useLoad } from "../components/ui";

export interface Notes {
  general: string;
  scenes: Record<string, string>;
}
export type NotesBook = Record<string, Notes>;

export function StoryboardTab(props: {
  project: ProjectDetail;
  notes: NotesBook;
  setNotes: (key: string, notes: Notes) => void;
  onSent: () => void;
  onApprove: () => void;
  agentBusy: boolean;
}) {
  const { project } = props;
  const written = project.videos.filter((v) => v.exists);
  const [video, setVideo] = useState<VideoTarget["id"]>(written[0]?.id ?? "main");
  const target = project.videos.find((v) => v.id === video) ?? project.videos[0];
  const [format, setFormat] = useState<FormatName>(target.formats[0]?.format ?? "landscape");
  useEffect(() => {
    if (!target.formats.some((f) => f.format === format)) setFormat(target.formats[0]?.format ?? "landscape");
  }, [target, format]);

  const review = useLoad(() => invoke("review:get", project.id, video, format), [project.id, video, format, project.updatedAt]);
  const key = `${video}:${format}`;
  const notes = props.notes[key] ?? { general: "", scenes: {} };
  const count = Object.values(notes.scenes).filter((n) => n.trim()).length + (notes.general.trim() ? 1 : 0);
  const send = useAction();
  const [zoom, setZoom] = useState<string | undefined>();
  const version = project.updatedAt;

  const sendNotes = () =>
    send.run(async () => {
      await invoke("review:send-notes", project.id, {
        video,
        format,
        general: notes.general,
        scenes: Object.entries(notes.scenes).map(([k, note]) => ({ key: k, note })),
      });
      props.setNotes(key, { general: "", scenes: {} });
      props.onSent();
    });

  const scenes = review.data?.scenes ?? [];
  const portrait = format === "portrait";
  const hasShots = useMemo(() => scenes.some((s) => s.shot), [scenes]);

  if (!written.length)
    return (
      <div className="card">
        <div className="empty">
          <MessageSquareText size={30} />
          <h3>Chưa có kịch bản</h3>
          <p>Khi agent viết xong và dựng storyboard, từng cảnh sẽ hiện ở đây để bạn duyệt.</p>
        </div>
      </div>
    );

  return (
    <div className="stack">
      <div className="row wrap">
        {written.length > 1 && (
          <div className="segmented">
            {written.map((v) => (
              <button key={v.id} className={v.id === video ? "active" : ""} onClick={() => setVideo(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
        )}
        {target.formats.length > 1 && (
          <div className="segmented">
            {target.formats.map((f) => (
              <button key={f.format} className={f.format === format ? "active" : ""} onClick={() => setFormat(f.format)}>
                {FORMAT_LABEL[f.format]}
              </button>
            ))}
          </div>
        )}
        <span className="grow" />
        {review.data?.duration !== undefined && <span className="muted small">Dài {clock(review.data.duration)} · {scenes.length} cảnh</span>}
        <button className="btn small" disabled={review.loading} onClick={() => void review.reload()}>
          <RefreshCw size={13} /> Tải lại
        </button>
        {review.data?.storyboard && (
          <button className="btn small" onClick={() => void invoke("projects:reveal", project.id, relative(project.dir, review.data!.storyboard!))}>
            <ExternalLink size={13} /> storyboard.jpg
          </button>
        )}
      </div>

      {!target.valid && target.errors.length > 0 && (
        <Banner kind="error">
          {target.script} còn lỗi: {target.errors[0].path}: {target.errors[0].message}
        </Banner>
      )}
      {review.data?.stale && <Banner kind="warn">Kịch bản đã đổi sau lần dựng storyboard này: ảnh có thể chưa khớp lời thoại.</Banner>}
      {review.data && !hasShots && <Banner>Chưa có storyboard cho định dạng này. Agent dựng storyboard bằng Studio tools; danh sách cảnh dưới đây lấy từ kịch bản.</Banner>}
      <ErrorBanner error={review.error} />

      <div className="card">
        {review.loading && !review.data ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : (
          scenes.map((s) => (
            <div key={`${s.index}-${s.key}`} className={`scene${portrait ? " portrait" : ""}${s.kind !== "scene" ? " card-kind" : ""}`}>
              {s.shot ? (
                <img className="shot" src={mediaUrl(s.shot, version)} alt={s.key} loading="lazy" onClick={() => setZoom(s.shot)} />
              ) : (
                <div className="shot placeholder">
                  <ImageOff size={22} />
                </div>
              )}
              <div className="scene-meta">
                <div className="row wrap">
                  <strong className="mono">{s.key}</strong>
                  <span className="badge">{s.type}</span>
                  {s.start !== undefined && s.end !== undefined && (
                    <span className="small muted">
                      {clock(s.start)}–{clock(s.end)} ({Math.max(0, s.end - s.start).toFixed(1)}s)
                    </span>
                  )}
                  <span className="grow" />
                  <span className="small faint ellipsis">{s.chapter}</span>
                </div>
                {s.voice ? <p className="pre-wrap">{s.voice}</p> : <p className="faint small">Không có lời thoại</p>}
                <textarea
                  rows={2}
                  placeholder={`Ghi chú cho cảnh ${s.key}…`}
                  value={notes.scenes[s.key] ?? ""}
                  onChange={(e) => props.setNotes(key, { ...notes, scenes: { ...notes.scenes, [s.key]: e.target.value } })}
                />
              </div>
            </div>
          ))
        )}
        <div className="notes-bar">
          <label className="field grow">
            Ghi chú chung
            <textarea rows={2} placeholder="Nhịp nhanh hơn, bớt chữ trên màn hình…" value={notes.general} onChange={(e) => props.setNotes(key, { ...notes, general: e.target.value })} />
          </label>
          <div className="stack tight">
            <button className="btn primary" disabled={!count || send.busy || props.agentBusy} onClick={() => void sendNotes()}>
              <Send size={14} /> Gửi {count || ""} ghi chú cho agent
            </button>
            <button className="btn" disabled={!hasShots} onClick={props.onApprove}>
              Duyệt, sang render
            </button>
          </div>
        </div>
      </div>
      {props.agentBusy && (
        <span className="row small muted">
          <TriangleAlert size={13} /> Agent đang làm việc; gửi ghi chú khi agent xong lượt.
        </span>
      )}
      <ErrorBanner error={send.error} />
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(undefined)}>
          <img src={mediaUrl(zoom, version)} alt="" />
        </div>
      )}
    </div>
  );
}

function relative(dir: string, path: string): string {
  const d = dir.replace(/\\/g, "/").replace(/\/$/, "");
  const p = path.replace(/\\/g, "/");
  return p.startsWith(`${d}/`) ? p.slice(d.length + 1) : p;
}
