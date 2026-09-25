/**
 * The render queue (design doc §3, step 5): the user renders after approving
 * the storyboard; one job per video, its formats one after another, one job
 * on the machine at a time (the engine host's gate), with progress and cancel.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RenderJob, RenderQuality, VideoTarget } from "../shared/types";
import type { HostEvent } from "../engine/protocol";
import type { EngineClient } from "./engine";
import { videoTargets, type ProjectStore } from "./projects";

export interface RenderDeps {
  engine: Pick<EngineClient, "call">;
  projects: ProjectStore;
  emit(job: RenderJob): void;
  /** true while a job is queued or running (keep the machine awake) */
  onBusy?(busy: boolean): void;
  /** a job finished, failed or was cancelled */
  onFinished?(job: RenderJob): void;
}

const KEEP_FINISHED = 30;

export class RenderQueue {
  private jobs: RenderJob[] = [];

  constructor(private readonly deps: RenderDeps) {}

  list(): RenderJob[] {
    return this.jobs;
  }

  /** Queues the project's videos (all by default) in every format their scripts ask for. */
  async start(projectId: string, opts: { videos?: VideoTarget["id"][]; quality: RenderQuality }): Promise<RenderJob[]> {
    const { projects, engine } = this.deps;
    const dir = projects.dir(projectId);
    const project = await projects.read(projectId);
    // a video whose script is not written yet is left out; one whose script is broken stops the whole batch
    const written = videoTargets(project.kind).filter((t) => (!opts.videos || opts.videos.includes(t.id)) && existsSync(join(dir, t.script)));
    const ready = await Promise.all(written.map(async (t) => ({ t, check: await engine.call("checkScript", { dir, script: t.script }) })));
    const broken = ready.find(({ check }) => !check.ok);
    if (broken) {
      const { t, check } = broken;
      throw new Error(`${t.label}: ${t.script} còn lỗi (${check.errors[0]?.path}: ${check.errors[0]?.message}). Nhờ agent sửa trước khi render.`);
    }
    if (!ready.length) throw new Error("Chưa có kịch bản nào để render.");

    const added: RenderJob[] = [];
    for (const { t, check } of ready) {
      if (this.jobs.some((j) => j.projectId === projectId && j.video === t.id && (j.status === "queued" || j.status === "running"))) continue;
      const { jobId } = await engine.call("render", { dir, script: t.script, formats: check.formats, quality: opts.quality });
      const existing = this.jobs.find((j) => j.id === jobId);
      const job: RenderJob = {
        id: jobId,
        projectId,
        title: project.title,
        video: t.id,
        formats: check.formats,
        quality: opts.quality,
        status: existing?.status ?? "queued",
        percent: existing?.percent ?? 0,
        stage: existing?.stage,
        outputs: [],
        queuedAt: new Date().toISOString(),
      };
      this.jobs = [...this.jobs.filter((j) => j.id !== jobId), job];
      this.prune();
      this.deps.emit(job);
      added.push(job);
    }
    this.busyChanged();
    return added;
  }

  async cancel(jobId: string): Promise<void> {
    await this.deps.engine.call("cancel", { jobId });
  }

  onHostEvent(e: HostEvent): void {
    if (e.type !== "render") return;
    let job = this.jobs.find((j) => j.id === e.jobId);
    // events can arrive before start() has recorded the job
    if (!job) {
      job = { id: e.jobId, projectId: "", title: "", video: "main", formats: [], quality: "standard", status: e.status, percent: 0, outputs: [], queuedAt: new Date().toISOString() };
      this.jobs.push(job);
    }
    job.status = e.status;
    if (e.format) job.format = e.format;
    if (e.stage) job.stage = e.stage;
    if (e.percent !== undefined) job.percent = e.percent;
    if (e.error) job.error = e.error;
    if (e.outputs) job.outputs = e.outputs;
    const finished = e.status === "done" || e.status === "failed" || e.status === "cancelled";
    if (finished) job.finishedAt = new Date().toISOString();
    if (job.projectId) this.deps.emit(job);
    if (finished && job.projectId) this.deps.onFinished?.(job);
    this.busyChanged();
  }

  /** The engine host died: nothing it had queued will run. */
  onHostExit(): void {
    for (const job of this.jobs) {
      if (job.status !== "queued" && job.status !== "running") continue;
      job.status = "failed";
      job.error = "Engine dừng đột ngột; bấm Render để chạy lại";
      job.finishedAt = new Date().toISOString();
      this.deps.emit(job);
    }
    this.busyChanged();
  }

  private busyChanged(): void {
    this.deps.onBusy?.(this.jobs.some((j) => j.status === "queued" || j.status === "running"));
  }

  private prune(): void {
    const finished = this.jobs.filter((j) => j.finishedAt);
    const drop = new Set(finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)).map((j) => j.id));
    this.jobs = this.jobs.filter((j) => !drop.has(j.id));
  }
}
