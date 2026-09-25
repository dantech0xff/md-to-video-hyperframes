import { describe, it, expect } from "vitest";
import { Gate, JobRunner } from "./jobs.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("JobRunner", () => {
  it("answers after a bounded wait while the job keeps running", async () => {
    const jobs = new JobRunner();
    const job = jobs.start("slow", async () => {
      await sleep(80);
      return 42;
    });
    await jobs.wait(job, 5);
    expect(job.status).toBe("running");
    await jobs.wait(job, 1000);
    expect(job).toMatchObject({ status: "done", result: 42 });
  });

  it("runs one job at a time, in order", async () => {
    const jobs = new JobRunner();
    const order: string[] = [];
    const a = jobs.start("a", async () => {
      order.push("a start");
      await sleep(30);
      order.push("a end");
    });
    const b = jobs.start("b", async () => {
      order.push("b start");
    });
    expect(b.status).toBe("queued");
    await b.done;
    expect(a.status).toBe("done");
    expect(order).toEqual(["a start", "a end", "b start"]);
  });

  it("records failures and cancellations without rejecting", async () => {
    const jobs = new JobRunner();
    const failed = jobs.start("boom", async () => {
      throw new Error("TTS quota exceeded");
    });
    await failed.done;
    expect(failed).toMatchObject({ status: "failed", error: "TTS quota exceeded" });

    const running = jobs.start("long", ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
    const queued = jobs.start("next", async () => "never");
    await sleep(5);
    jobs.cancelAll();
    await queued.done;
    expect(running.status).toBe("cancelled");
    expect(queued.status).toBe("cancelled");
  });

  it("forgets old finished jobs, even when they were all queued at once", async () => {
    const jobs = new JobRunner();
    const all = Array.from({ length: 25 }, (_, i) => jobs.start(`job-${i}`, async () => i));
    await all[24].done;
    expect(all.slice(0, 5).map((j) => jobs.get(j.id))).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(jobs.get(all[5].id)).toBe(all[5]);
    expect(jobs.get(all[24].id)).toBe(all[24]);
  });

  it("collects the events a job reports", async () => {
    const jobs = new JobRunner();
    const job = jobs.start("events", async ({ onEvent }) => onEvent({ type: "info", message: "hello" }));
    await job.done;
    expect(job.events).toEqual([{ type: "info", message: "hello" }]);
    expect(jobs.get(job.id)).toBe(job);
  });

  it("takes turns with other runners that share its gate", async () => {
    const gate = new Gate();
    const renders = new JobRunner({ gate });
    const studio = new JobRunner({ gate });
    const order: string[] = [];
    const render = renders.start("render", async () => {
      order.push("render start");
      await sleep(40);
      order.push("render end");
    });
    await sleep(5);
    const storyboard = studio.start("build_storyboard", async () => {
      order.push("storyboard start");
    });
    await sleep(10);
    // waiting for the gate counts as queued, not running
    expect(storyboard.status).toBe("queued");
    await storyboard.done;
    expect(render.status).toBe("done");
    expect(order).toEqual(["render start", "render end", "storyboard start"]);
  });

  it("stops waiting for the gate when cancelled, without jumping the queue", async () => {
    const gate = new Gate();
    const a = new JobRunner({ gate });
    const b = new JobRunner({ gate });
    const c = new JobRunner({ gate });
    const order: string[] = [];
    const long = a.start("long", async () => {
      await sleep(40);
      order.push("long end");
    });
    await sleep(5);
    const waiting = b.start("waiting", async () => {
      order.push("waiting ran");
    });
    const next = c.start("next", async () => {
      order.push("next start");
    });
    await sleep(5);
    waiting.cancel();
    await waiting.done;
    expect(waiting).toMatchObject({ status: "cancelled", error: "cancelled before it started" });
    expect(long.status).toBe("running");
    await next.done;
    expect(order).toEqual(["long end", "next start"]);
  });
});
