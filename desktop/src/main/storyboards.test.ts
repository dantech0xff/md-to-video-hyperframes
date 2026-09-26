import { describe, it, expect, vi } from "vitest";
import type { HostEvent } from "../engine/protocol";
import type { StoryboardJob } from "../shared/types";
import { videoTargets } from "./projects";
import { StoryboardBuilds } from "./storyboards";

const [main, short] = videoTargets("lesson");

function builds() {
  const emitted: StoryboardJob[] = [];
  const finished: StoryboardJob[] = [];
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let host: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined;
  const engine = {
    call: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return host?.(method, params);
    }),
  };
  const b = new StoryboardBuilds({
    engine: engine as never,
    projects: { dir: (id: string) => `/Users/dan/Movies/Get Frames/${id}` },
    // a copy of each state, as the renderer receives it
    emit: (job) => emitted.push({ ...job }),
    onFinished: (job) => finished.push({ ...job }),
  });
  return { b, emitted, finished, calls, setHost: (fn: typeof host) => (host = fn) };
}

const event = (jobId: string, e: Omit<Extract<HostEvent, { type: "storyboard" }>, "type" | "jobId">): HostEvent => ({ type: "storyboard", jobId, ...e });

describe("StoryboardBuilds", () => {
  it("asks the engine host for the video's storyboard under an id of its own and follows it to its end", async () => {
    const { b, emitted, finished, calls } = builds();
    const job = await b.start("p1", short);
    expect(calls).toEqual([{ method: "storyboard", params: { dir: "/Users/dan/Movies/Get Frames/p1", script: "short/script.json", jobId: job.id } }]);
    expect(emitted.at(-1)).toMatchObject({ id: job.id, projectId: "p1", video: "short", status: "queued" });

    b.onHostEvent(event(job.id, { status: "running", step: "narration", percent: 40 }));
    b.onHostEvent(event(job.id, { status: "running", step: "capture", format: "portrait" }));
    expect(emitted.at(-1)).toMatchObject({ status: "running", step: "capture", format: "portrait" });
    expect(finished).toEqual([]);
    b.onHostEvent(event(job.id, { status: "done" }));
    expect(emitted.at(-1)).toEqual({ id: job.id, projectId: "p1", video: "short", status: "done", step: undefined, format: undefined, percent: undefined, error: undefined });
    expect(finished).toEqual([emitted.at(-1)]);
    // another project's job, or one the host never started, changes nothing
    b.onHostEvent(event("storyboard-x", { status: "failed", error: "?" }));
    b.onHostEvent({ type: "render", jobId: job.id, status: "failed" });
    expect(finished).toHaveLength(1);
    expect(b.list("p1")).toEqual([emitted.at(-1)]);
    expect(b.list("p2")).toEqual([]);
  });

  it("cancels the earlier build of a video when it is built again, and forgets it", async () => {
    const { b, emitted, finished, calls } = builds();
    const first = await b.start("p1", main);
    const other = await b.start("p1", short);
    b.onHostEvent(event(first.id, { status: "running", step: "narration", percent: 10 }));
    const second = await b.start("p1", main);
    expect(calls.map((c) => [c.method, c.params.jobId])).toEqual([
      ["storyboard", first.id],
      ["storyboard", other.id],
      ["cancel", first.id],
      ["storyboard", second.id],
    ]);
    expect(b.list("p1").map((j) => j.id)).toEqual([other.id, second.id]);
    // the cancelled build's end is not the video's
    const seen = emitted.length;
    b.onHostEvent(event(first.id, { status: "cancelled", error: "cancelled" }));
    expect(emitted).toHaveLength(seen);
    expect(finished).toEqual([]);

    // a build that ended is not cancelled again
    b.onHostEvent(event(second.id, { status: "failed", error: "TTS unreachable" }));
    await b.start("p1", main);
    expect(calls.filter((c) => c.method === "cancel")).toHaveLength(1);
  });

  it("fails a build the engine host would not start, or lost when it stopped", async () => {
    const { b, finished, setHost } = builds();
    setHost(async (method) => {
      if (method === "storyboard") throw new Error("script.json leads outside the project folder through a symbolic link");
    });
    const refused = await b.start("p1", main);
    expect(refused).toMatchObject({ status: "failed", error: expect.stringMatching(/symbolic link/) });
    expect(finished.map((j) => j.id)).toEqual([refused.id]);

    setHost(async () => undefined);
    const lost = await b.start("p1", short);
    b.onHostEvent(event(lost.id, { status: "running", step: "capture", format: "portrait" }));
    b.onHostExit();
    expect(b.list("p1").find((j) => j.id === lost.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/Engine dừng/), step: undefined });
    expect(finished.map((j) => j.id)).toEqual([refused.id, lost.id]);
  });
});
