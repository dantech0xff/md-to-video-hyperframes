/**
 * Storyboards the app builds itself (design doc §3, step 4): after the user
 * edits a script in the storyboard review, or when they ask for one again.
 * The agent builds its own through the Studio tools. The latest build of each
 * video is kept; a newer one cancels it, since it would show an older script.
 */
import type { HostEvent } from "../engine/protocol";
import type { StoryboardJob, VideoTarget } from "../shared/types";
import type { EngineClient } from "./engine";
import type { ProjectStore } from "./projects";

export interface StoryboardDeps {
  engine: Pick<EngineClient, "call">;
  projects: Pick<ProjectStore, "dir">;
  emit(job: StoryboardJob): void;
  /** a build finished, failed or was cancelled */
  onFinished?(job: StoryboardJob): void;
}

export class StoryboardBuilds {
  private jobs: StoryboardJob[] = [];
  private seq = 0;
  /** each video's builds start one after another, by project and video */
  private starting = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: StoryboardDeps) {}

  /** The latest build of each video, of one project or of all. */
  list(projectId?: string): StoryboardJob[] {
    return this.jobs.filter((j) => projectId === undefined || j.projectId === projectId);
  }

  /**
   * Builds the video's storyboard again, from its script as it is when the
   * build runs. It starts once the video's earlier build is with the engine
   * host: cancelling that one before the host has it would not stop it.
   */
  start(projectId: string, target: VideoTarget): Promise<StoryboardJob> {
    const key = `${projectId}\n${target.id}`;
    const started = (this.starting.get(key) ?? Promise.resolve()).then(() => this.startNow(projectId, target));
    const settled = started.catch(() => undefined);
    this.starting.set(key, settled);
    void settled.then(() => {
      if (this.starting.get(key) === settled) this.starting.delete(key);
    });
    return started;
  }

  private async startNow(projectId: string, target: VideoTarget): Promise<StoryboardJob> {
    const dir = this.deps.projects.dir(projectId);
    const earlier = this.jobs.find((j) => j.projectId === projectId && j.video === target.id);
    const job: StoryboardJob = { id: `storyboard-${Date.now().toString(36)}-${++this.seq}`, projectId, video: target.id, status: "queued" };
    // the new build takes the video's place: what the earlier one still reports goes nowhere
    this.jobs = [...this.jobs.filter((j) => j !== earlier), job];
    if (earlier && active(earlier)) await this.deps.engine.call("cancel", { jobId: earlier.id }).catch(() => undefined);
    this.deps.emit(job);
    try {
      await this.deps.engine.call("storyboard", { dir, script: target.script, jobId: job.id });
    } catch (e) {
      this.finish(job, { status: "failed", error: (e as Error).message });
    }
    return job;
  }

  /** Stops build `jobId` of the project: only a storyboard of that project, and only while it runs (the engine host runs renders too). */
  async cancel(projectId: string, jobId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId && j.projectId === projectId);
    if (job && active(job)) await this.deps.engine.call("cancel", { jobId });
  }

  onHostEvent(e: HostEvent): void {
    if (e.type !== "storyboard") return;
    const job = this.jobs.find((j) => j.id === e.jobId);
    if (!job) return;
    const { status, step, format, percent, error } = e;
    if (!active({ status })) this.finish(job, { status, error });
    else {
      Object.assign(job, { status, step, format, percent });
      this.deps.emit(job);
    }
  }

  /** The engine host died: nothing it had queued will run. */
  onHostExit(): void {
    for (const job of this.jobs) if (active(job)) this.finish(job, { status: "failed", error: "Engine dừng đột ngột; bấm Dựng lại để chạy lại" });
  }

  private finish(job: StoryboardJob, end: Pick<StoryboardJob, "status" | "error">): void {
    if (!active(job)) return;
    Object.assign(job, { step: undefined, format: undefined, percent: undefined, ...end });
    this.deps.emit(job);
    this.deps.onFinished?.(job);
  }
}

function active(job: Pick<StoryboardJob, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}
