/** Render queue (design doc §3, step 5): after the storyboard is approved; progress, cancel, one job at a time. */
import { useState } from "react";
import { CircleCheck, Clapperboard, Moon, Square } from "lucide-react";
import type { ProjectDetail, RenderJob, RenderQuality, VideoTarget } from "../../../shared/types";
import { invoke } from "../lib/api";
import { ago, clock, FORMAT_LABEL, QUALITY_LABEL, RENDER_STATUS_LABEL } from "../lib/format";
import { Banner, ErrorBanner, Progress, Spinner, useAction } from "../components/ui";

export function RenderTab({ project, jobs, onResults }: { project: ProjectDetail; jobs: RenderJob[]; onResults: () => void }) {
  const [quality, setQuality] = useState<RenderQuality>("standard");
  const start = useAction();
  const mine = jobs.filter((j) => j.projectId === project.id).slice().reverse();
  const active = (video: VideoTarget["id"]) => mine.some((j) => j.video === video && (j.status === "queued" || j.status === "running"));
  const written = project.videos.filter((v) => v.exists);
  const render = (videos?: VideoTarget["id"][]) => start.run(() => invoke("render:start", project.id, { videos, quality }));

  return (
    <div className="stack">
      <div className="card">
        <div className="card-body stack">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <h2>Render</h2>
            <div className="row">
              <span className="small muted">Chất lượng</span>
              <div className="segmented">
                {(Object.keys(QUALITY_LABEL) as RenderQuality[]).map((q) => (
                  <button key={q} className={q === quality ? "active" : ""} onClick={() => setQuality(q)}>
                    {QUALITY_LABEL[q]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="small muted row">
            <Moon size={13} /> Render mất khoảng 5–6 lần thời lượng video, lần lượt từng định dạng. Máy không ngủ khi đang render; app báo khi xong.
          </p>
          {!written.length && <Banner>Chưa có kịch bản nào để render.</Banner>}
          {written.map((v) => (
            <div key={v.id} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
              <div className="grow stack tight" style={{ gap: 2 }}>
                <strong>{v.label}</strong>
                <span className="small muted">
                  {v.script} · {v.formats.map((f) => `${FORMAT_LABEL[f.format]}${f.duration ? ` ${clock(f.duration)}` : ""}${f.video ? " ✓" : ""}`).join(" · ")}
                </span>
                {!v.valid && v.errors[0] && (
                  <span className="small" style={{ color: "var(--danger)" }}>
                    Còn lỗi: {v.errors[0].path}: {v.errors[0].message}
                  </span>
                )}
              </div>
              <button className="btn" disabled={!v.valid || active(v.id) || start.busy} onClick={() => void render([v.id])}>
                {v.formats.every((f) => f.video) ? "Render lại" : "Render"}
              </button>
            </div>
          ))}
          {written.length > 1 && (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn primary" disabled={start.busy || !written.every((v) => v.valid)} onClick={() => void render()}>
                <Clapperboard size={15} /> Render tất cả
              </button>
            </div>
          )}
          <ErrorBanner error={start.error} />
        </div>
      </div>

      {mine.length > 0 && (
        <div className="card">
          {mine.map((job) => (
            <JobRow key={job.id} job={job} label={project.videos.find((v) => v.id === job.video)?.label ?? job.video} onResults={onResults} />
          ))}
        </div>
      )}
    </div>
  );
}

export function JobRow({ job, label, onResults }: { job: RenderJob; label: string; onResults?: () => void }) {
  const cancel = useAction();
  const running = job.status === "running" || job.status === "queued";
  return (
    <div className="job">
      <div className="row">
        {running ? <Spinner size={15} /> : job.status === "done" ? <CircleCheck size={15} color="var(--accent)" /> : null}
        <strong className="grow">
          {label} · {job.formats.map((f) => FORMAT_LABEL[f]).join(", ")} · {QUALITY_LABEL[job.quality]}
        </strong>
        <span className={`badge ${job.status === "done" ? "green" : job.status === "failed" ? "red" : job.status === "running" ? "blue" : ""}`}>{RENDER_STATUS_LABEL[job.status]}</span>
        {running && (
          <button className="btn small danger" disabled={cancel.busy} onClick={() => void cancel.run(() => invoke("render:cancel", job.id))}>
            <Square size={12} /> Huỷ
          </button>
        )}
        {job.status === "done" && onResults && (
          <button className="btn small" onClick={onResults}>
            Xem kết quả
          </button>
        )}
      </div>
      {running && (
        <>
          <Progress percent={job.percent} indeterminate={job.status === "queued"} />
          <span className="small muted">
            {job.status === "queued" ? "Đang chờ việc khác xong" : `${job.format ? `${FORMAT_LABEL[job.format]} · ` : ""}${job.stage ?? "Đang chuẩn bị"} · ${job.percent}%`}
          </span>
        </>
      )}
      {job.error && job.status !== "cancelled" && <span className="small" style={{ color: "var(--danger)" }}>{job.error}</span>}
      {job.finishedAt && <span className="small faint">{ago(job.finishedAt)}</span>}
      <ErrorBanner error={cancel.error} />
    </div>
  );
}
