import { describe, it, expect } from "vitest";
import { JobRunner } from "./jobs.js";

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

  it("collects the events a job reports", async () => {
    const jobs = new JobRunner();
    const job = jobs.start("events", async ({ onEvent }) => onEvent({ type: "info", message: "hello" }));
    await job.done;
    expect(job.events).toEqual([{ type: "info", message: "hello" }]);
    expect(jobs.get(job.id)).toBe(job);
  });
});
