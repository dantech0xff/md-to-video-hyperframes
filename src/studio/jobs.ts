/**
 * Studio jobs (layout checks, storyboards) for one project run one at a time:
 * two runs writing the same format folders at once would corrupt each other,
 * and the machine's CPU is shared with renders anyway. A tool call waits a
 * bounded time for its job and otherwise answers "running"; the agent then
 * polls with wait_job. Codex cancels MCP calls after 60 s by default.
 */
import { randomUUID } from "node:crypto";
import type { LessonEvent } from "../lesson/events.js";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobContext {
  signal: AbortSignal;
  onEvent: (e: LessonEvent) => void;
}

export interface Job<T = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  events: LessonEvent[];
  result?: T;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** settles when the job ends; never rejects */
  done: Promise<void>;
  cancel(): void;
}

/** Finished jobs kept for wait_job; older ones are dropped. */
const KEEP_FINISHED = 20;

export class JobRunner {
  private tail: Promise<void> = Promise.resolve();
  private readonly jobs = new Map<string, Job>();

  start<T>(kind: string, run: (ctx: JobContext) => Promise<T>): Job<T> {
    const controller = new AbortController();
    const job: Job<T> = {
      id: randomUUID().slice(0, 8),
      kind,
      status: "queued",
      events: [],
      done: Promise.resolve(),
      cancel: () => controller.abort(new Error("cancelled")),
    };
    job.done = this.tail.then(async () => {
      if (controller.signal.aborted) {
        job.status = "cancelled";
        job.error = "cancelled before it started";
        return;
      }
      job.status = "running";
      job.startedAt = Date.now();
      try {
        job.result = await run({ signal: controller.signal, onEvent: (e) => job.events.push(e) });
        job.status = "done";
      } catch (e) {
        job.status = controller.signal.aborted ? "cancelled" : "failed";
        job.error = (e as Error).message;
      } finally {
        job.finishedAt = Date.now();
        this.prune();
      }
    });
    this.tail = job.done;
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Resolves when the job ends or after `ms`, whichever comes first. */
  async wait(job: Job, ms: number): Promise<Job> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([job.done, new Promise<void>((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
    return job;
  }

  /** Cancels queued and running jobs, e.g. when the project closes. */
  cancelAll(): void {
    for (const job of this.jobs.values()) if (job.status === "queued" || job.status === "running") job.cancel();
  }

  private prune(): void {
    const finished = [...this.jobs.values()].filter((j) => j.finishedAt !== undefined);
    for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) this.jobs.delete(j.id);
  }
}
