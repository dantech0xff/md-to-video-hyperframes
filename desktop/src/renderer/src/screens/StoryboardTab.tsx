/**
 * Storyboard review (design doc §3, step 4): every scene's frame, narration
 * and timing, with a note per scene; the notes go to the agent as one message.
 * A small change the user makes in a scene's form instead (2.3), and the app
 * builds the storyboard again itself.
 */
import { useMemo, useState } from "react";
import { ExternalLink, ImageOff, MessageSquareText, Pencil, RefreshCw, Send, TriangleAlert, X } from "lucide-react";
import type { FormatName, ProjectDetail, StoryboardJob, VideoTarget } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke, useEvent } from "../lib/api";
import { buildStage, clock, FORMAT_LABEL } from "../lib/format";
import { reviewFor, shownFormat, shownVideo, videoBuild } from "../lib/pick";
import { Banner, ErrorBanner, Progress, Spinner, useAction, useLoad } from "../components/ui";
import { SceneEditor } from "./SceneEditor";

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
  // what the user picked, as long as it is there: otherwise the first written video (a lesson's Short may come first) and its first format
  const [pickedVideo, setVideo] = useState<VideoTarget["id"]>(written[0]?.id ?? "main");
  const video = shownVideo(project.videos, pickedVideo);
  const target = project.videos.find((v) => v.id === video) ?? project.videos[0];
  const [pickedFormat, setFormat] = useState<FormatName>(target.formats[0]?.format ?? "landscape");
  const format = shownFormat(target, pickedFormat);

  const loaded = useLoad(async () => ({ video, ...(await invoke("review:get", project.id, video, format)) }), [project.id, video, format, project.updatedAt]);
  // the scenes of the video and format picked, never those of the one shown before while they load: an Edit there would open another video's scene
  const review = { ...loaded, data: reviewFor(loaded.data, video, format) };
  const key = `${video}:${format}`;
  const notes = props.notes[key] ?? { general: "", scenes: {} };
  const count = Object.values(notes.scenes).filter((n) => n.trim()).length + (notes.general.trim() ? 1 : 0);
  const send = useAction();
  const [zoom, setZoom] = useState<string | undefined>();
  const version = project.updatedAt;
  // the scene whose form is open, in the video it belongs to
  const [editing, setEditing] = useState<{ video: VideoTarget["id"]; key: string }>();

  // the storyboards the app builds after an edit: the latest of each video
  const listed = useLoad(() => invoke("storyboard:list", project.id), [project.id]);
  const [seen, setSeen] = useState<StoryboardJob[]>([]);
  useEvent("event:storyboard", (job) => {
    if (job.projectId === project.id) setSeen((all) => [...all.filter((j) => j.video !== job.video), job]);
  });
  const build = videoBuild(seen, listed.data, project.id, video);
  const building = build?.status === "queued" || build?.status === "running";
  const rebuild = useAction();
  const buildAgain = () => rebuild.run(() => invoke("storyboard:build", project.id, video));

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
      {building && build && (
        <Banner>
          <div className="stack tight">
            <div className="row wrap">
              <span className="grow">Đang dựng lại storyboard theo kịch bản mới: {buildStage(build)}</span>
              <button type="button" className="btn small" onClick={() => void invoke("storyboard:cancel", build.id)}>
                <X size={13} /> Dừng
              </button>
            </div>
            <Progress percent={build.percent} indeterminate={build.percent === undefined} />
          </div>
        </Banner>
      )}
      {!building && build?.status === "failed" && (
        <Banner kind="error">
          <div className="row wrap">
            <span className="grow">Dựng lại storyboard lỗi: {build.error}</span>
            <button type="button" className="btn small" disabled={rebuild.busy} onClick={() => void buildAgain()}>
              <RefreshCw size={13} /> Dựng lại
            </button>
          </div>
        </Banner>
      )}
      {!building && build?.status !== "failed" && review.data?.stale && (
        <Banner kind="warn">
          <div className="row wrap">
            <span className="grow">Kịch bản đã đổi sau lần dựng storyboard này: ảnh có thể chưa khớp lời thoại.</span>
            <button type="button" className="btn small" disabled={rebuild.busy} onClick={() => void buildAgain()}>
              <RefreshCw size={13} /> Dựng lại storyboard
            </button>
          </div>
        </Banner>
      )}
      <ErrorBanner error={rebuild.error} />
      {review.data && !hasShots && <Banner>Chưa có storyboard cho định dạng này. Agent dựng storyboard bằng Studio tools; danh sách cảnh dưới đây lấy từ kịch bản.</Banner>}
      <ErrorBanner error={review.error} />

      <div className="card">
        {review.loading && !review.data ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : (
          scenes.map((s) => (
            <div key={`${s.index}-${s.key}`} className="scene-row">
              <div className={`scene${portrait ? " portrait" : ""}${s.kind !== "scene" ? " card-kind" : ""}`}>
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
                    {s.kind !== "intro" && (
                      <button
                        type="button"
                        className="btn small"
                        disabled={props.agentBusy}
                        title={props.agentBusy ? "Agent đang làm việc: sửa khi agent xong lượt" : "Sửa chữ, lời thoại và số liệu của cảnh này, không cần agent"}
                        onClick={() => setEditing({ video, key: s.key })}
                      >
                        <Pencil size={13} /> Sửa
                      </button>
                    )}
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
              {editing?.video === video && editing.key === s.key && (
                <SceneEditor
                  project={project}
                  video={video}
                  sceneKey={s.key}
                  agentBusy={props.agentBusy}
                  onClose={() => setEditing(undefined)}
                  onSaved={() => setEditing(undefined)}
                />
              )}
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
