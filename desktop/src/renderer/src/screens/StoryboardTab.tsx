/**
 * Storyboard review (design doc §3, step 4): every scene's frame, narration
 * and timing, with a note per scene; the notes go to the agent as one message.
 * A small change the user makes in a scene's form instead (2.3), and the app
 * builds the storyboard again itself.
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, ImageOff, MessageSquareText, Pencil, Plus, RefreshCw, Send, Trash2, TriangleAlert, X } from "lucide-react";
import type { FormatName, ProjectDetail, SavePartResult, StoryboardJob, StoryboardScene, VideoTarget } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke, useEvent } from "../lib/api";
import { buildStage, clock, FORMAT_LABEL } from "../lib/format";
import { buildBanner, reviewFor, shownFormat, shownVideo, videoBuild } from "../lib/pick";
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
  const banner = buildBanner(build, review.data);
  const rebuild = useAction();
  const buildAgain = () => rebuild.run(() => invoke("storyboard:build", project.id, video));

  const scenes = review.data?.scenes ?? [];

  const del = useAction();
  const removePart = (s: StoryboardScene) =>
    del.run(async () => {
      const what = s.kind === "scene" ? `cảnh ${s.key} (${s.type})` : s.kind === "chapter" ? `thẻ chương "${s.chapter}"` : s.kind === "intro" ? "intro" : "outro";
      if (!window.confirm(`Xoá ${what} khỏi kịch bản? Storyboard sẽ dựng lại theo kịch bản mới.`)) return;
      clearOthers(del);
      const part = await invoke("script:part", project.id, video, s.key);
      const res = await invoke("script:delete-part", project.id, video, { key: s.key, version: part.version });
      if (res.ok) return;
      if (res.conflict) {
        await review.reload();
        throw new Error("Kịch bản vừa đổi — đã tải lại, thử xoá lần nữa.");
      }
      throw new Error([...res.errors, ...res.others].map((e) => e.message).join("; "));
    });

  // every other change of the script's parts — add, duplicate, move — against the version the review was read at
  const mut = useAction();
  const mutate = (call: (version: string) => Promise<SavePartResult>) =>
    mut.run(async () => {
      clearOthers(mut);
      const res = await call(review.data!.version);
      if (res.ok) return;
      if (res.conflict) {
        await review.reload();
        throw new Error("Kịch bản vừa đổi — đã tải lại, thử lại.");
      }
      throw new Error([...res.errors, ...res.others].map((e) => e.message).join("; "));
    });
  // a scene's narration edited right on its row: the raw text, cue markers {…} and all
  const inl = useAction();
  const [inline, setInline] = useState<{ video: VideoTarget["id"]; key: string; fields: Record<string, unknown>; version: string; value: string } | undefined>();
  // one banner for all four actions: a run clears the stale error of the others, or it would mask a newer failure
  const clearOthers = (keep: ReturnType<typeof useAction>) => [send, del, mut, inl].forEach((a) => a !== keep && a.clear());
  const startInline = (s: StoryboardScene) =>
    inl.run(async () => {
      clearOthers(inl);
      const part = await invoke("script:part", project.id, video, s.key);
      setInline({ video, key: s.key, fields: part.value, version: part.version, value: typeof part.value.voice === "string" ? part.value.voice : "" });
    });
  const saveVoice = (s: StoryboardScene) =>
    inl.run(async () => {
      if (!inline || inline.video !== video) return;
      clearOthers(inl);
      const res = await invoke("script:save-part", project.id, video, { key: s.key, version: inline.version, value: { ...inline.fields, voice: inline.value } });
      if (res.ok) return setInline(undefined);
      if (res.conflict) {
        await review.reload();
        setInline(undefined);
        throw new Error("Kịch bản vừa đổi — đã tải lại, thử sửa lần nữa.");
      }
      throw new Error([...res.errors, ...res.others].map((e) => e.message).join("; "));
    });
  const types = useLoad(() => invoke("script:scene-types"), [project.id]);
  const [addType, setAddType] = useState("");
  const sceneType = addType || types.data?.[0] || "statement";
  const addScene = (chapterKey: string) => void mutate((version) => invoke("script:add-part", project.id, video, { kind: "scene", chapter: chapterKey, type: sceneType, version }));
  const addChapter = () => void mutate((version) => invoke("script:add-part", project.id, video, { kind: "chapter", type: sceneType, version }));
  const duplicate = (s: StoryboardScene) => void mutate((version) => invoke("script:duplicate-part", project.id, video, { key: s.key, version }));
  const move = (key: string, direction: "up" | "down") => void mutate((version) => invoke("script:move-part", project.id, video, { key, direction, version }));
  // a scene moves up inside its chapter, or into the chapter above when it is first; a chapter moves as a whole
  const scenePos = (s: StoryboardScene, i: number) => scenes.slice(0, i).filter((r) => r.kind === "scene" && r.chapterIndex === s.chapterIndex).length;
  const lastChapter = Math.max(0, ...scenes.filter((r) => r.kind === "scene").map((r) => r.chapterIndex));
  const canMove = (s: StoryboardScene, i: number, direction: "up" | "down") => {
    if (s.kind === "chapter") return direction === "up" ? s.chapterIndex > 0 : s.chapterIndex < lastChapter;
    if (s.kind !== "scene") return false;
    // down crosses into the next chapter too — only a scene after it in the same one, or a later chapter, makes it possible
    return direction === "up" ? scenePos(s, i) > 0 || s.chapterIndex > 0 : scenes.slice(i + 1).some((r) => r.kind === "scene" && r.chapterIndex === s.chapterIndex) || s.chapterIndex < lastChapter;
  };
  const typePicker = (
    <select className="pick" value={sceneType} onChange={(e) => setAddType(e.target.value)} disabled={props.agentBusy || mut.busy}>
      {(types.data ?? [sceneType]).map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );

  const sendNotes = () =>
    send.run(async () => {
      clearOthers(send);
      await invoke("review:send-notes", project.id, {
        video,
        format,
        general: notes.general,
        scenes: Object.entries(notes.scenes).map(([k, note]) => ({ key: k, note })),
      });
      props.setNotes(key, { general: "", scenes: {} });
      props.onSent();
    });

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
      {banner === "building" && build && (
        <Banner>
          <div className="stack tight">
            <div className="row wrap">
              <span className="grow">Đang dựng lại storyboard theo kịch bản mới: {buildStage(build)}</span>
              <button type="button" className="btn small" onClick={() => void invoke("storyboard:cancel", build.projectId, build.id)}>
                <X size={13} /> Dừng
              </button>
            </div>
            <Progress percent={build.percent} indeterminate={build.percent === undefined} />
          </div>
        </Banner>
      )}
      {(banner === "failed" || banner === "stopped") && (
        <Banner kind={banner === "failed" ? "error" : "warn"}>
          <div className="row wrap">
            <span className="grow">{banner === "failed" ? `Dựng lại storyboard lỗi: ${build?.error ?? ""}` : "Đã dừng dựng lại storyboard: ảnh chưa theo kịch bản mới."}</span>
            <button type="button" className="btn small" disabled={rebuild.busy} onClick={() => void buildAgain()}>
              <RefreshCw size={13} /> Dựng lại
            </button>
          </div>
        </Banner>
      )}
      {banner === "stale" && (
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
          scenes.map((s, i) => {
            const next = scenes[i + 1];
            // the chapter's last scene: the "add a scene" strip and, when the chapter shows no card, its move buttons
            const chapterEnd = s.kind === "scene" && (!next || next.chapterIndex !== s.chapterIndex || next.kind === "outro");
            const noCard = !scenes.some((r) => r.kind === "chapter" && r.chapterIndex === s.chapterIndex);
            return (
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
                    <button
                      type="button"
                      className="btn small"
                      disabled={props.agentBusy}
                      title={props.agentBusy ? "Agent đang làm việc: sửa khi agent xong lượt" : "Sửa chữ, lời thoại và số liệu của cảnh này, không cần agent"}
                      onClick={() => setEditing({ video, key: s.key })}
                    >
                      <Pencil size={13} /> Sửa
                    </button>
                    {(s.kind === "scene" || s.kind === "chapter") && (
                      <>
                        <button
                          type="button"
                          className="btn small icon-btn"
                          disabled={props.agentBusy || mut.busy || !canMove(s, i, "up")}
                          title={s.kind === "scene" ? "Chuyển cảnh lên một bước" : "Chuyển chương lên trước chương trên"}
                          onClick={() => move(s.key, "up")}
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn small icon-btn"
                          disabled={props.agentBusy || mut.busy || !canMove(s, i, "down")}
                          title={s.kind === "scene" ? "Chuyển cảnh xuống một bước" : "Chuyển chương xuống sau chương dưới"}
                          onClick={() => move(s.key, "down")}
                        >
                          <ChevronDown size={13} />
                        </button>
                      </>
                    )}
                    {s.kind === "scene" && (
                      <button
                        type="button"
                        className="btn small icon-btn"
                        disabled={props.agentBusy || mut.busy}
                        title="Nhân bản cảnh này ngay sau nó, với id mới"
                        onClick={() => duplicate(s)}
                      >
                        <Copy size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn small icon-btn danger"
                      disabled={props.agentBusy || del.busy}
                      title={props.agentBusy ? "Agent đang làm việc: xoá khi agent xong lượt" : "Xoá phần này khỏi kịch bản"}
                      onClick={() => void removePart(s)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {inline?.video === video && inline.key === s.key ? (
                    <div className="stack tight">
                      <textarea
                        rows={3}
                        autoFocus
                        value={inline.value}
                        disabled={inl.busy}
                        placeholder="Lời thoại của phần này…"
                        onChange={(e) => setInline({ ...inline, value: e.target.value })}
                        onKeyDown={(e) => e.key === "Escape" && setInline(undefined)}
                      />
                      <div className="row wrap">
                        <button type="button" className="btn primary small" disabled={inl.busy || props.agentBusy} onClick={() => void saveVoice(s)}>
                          {inl.busy ? <Spinner size={13} /> : <Check size={13} />} Lưu
                        </button>
                        <button type="button" className="btn small" onClick={() => setInline(undefined)}>
                          Huỷ
                        </button>
                        <span className="small faint">{"Các cue {…} giữ nguyên khi lưu"}</span>
                      </div>
                    </div>
                  ) : s.kind === "intro" ? (
                    <p className="faint small">Sting giới thiệu của brand — chọn chỗ nó phát trong Sửa.</p>
                  ) : (
                    <button
                      type="button"
                      className="voice-line pre-wrap"
                      disabled={props.agentBusy || inl.busy}
                      title={props.agentBusy ? "Agent đang làm việc: sửa khi agent xong lượt" : "Sửa lời thoại của phần này ngay tại đây, không cần agent"}
                      onClick={() => void startInline(s)}
                    >
                      {s.voice || <span className="faint small">Không có lời thoại — bấm để thêm</span>}
                    </button>
                  )}
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
              {chapterEnd && (
                <div className="add-strip">
                  {typePicker}
                  <button type="button" className="btn small" disabled={props.agentBusy || mut.busy} title={`Thêm cảnh vào cuối "${s.chapter}"`} onClick={() => addScene(`chapter-${s.chapterIndex + 1}`)}>
                    <Plus size={13} /> Thêm cảnh
                  </button>
                  {noCard && (
                    <span className="chapter-moves">
                      <span className="small faint ellipsis">{s.chapter}</span>
                      <button
                        type="button"
                        className="btn small icon-btn"
                        disabled={props.agentBusy || mut.busy || !canMove({ ...s, kind: "chapter" }, i, "up")}
                        title="Chuyển chương lên trước chương trên"
                        onClick={() => move(`chapter-${s.chapterIndex + 1}`, "up")}
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn small icon-btn"
                        disabled={props.agentBusy || mut.busy || !canMove({ ...s, kind: "chapter" }, i, "down")}
                        title="Chuyển chương xuống sau chương dưới"
                        onClick={() => move(`chapter-${s.chapterIndex + 1}`, "down")}
                      >
                        <ChevronDown size={13} />
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>
            );
          })
        )}
        {review.data && (
          <div className="add-strip">
            {typePicker}
            <button type="button" className="btn small" disabled={props.agentBusy || mut.busy} title="Thêm một chương mới ở cuối kịch bản, với một cảnh theo kiểu đã chọn" onClick={() => addChapter()}>
              <Plus size={13} /> Thêm chương
            </button>
          </div>
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
      <ErrorBanner error={send.error ?? del.error ?? mut.error ?? inl.error} />
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
