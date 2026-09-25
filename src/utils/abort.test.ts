import { describe, it, expect } from "vitest";
import { untilAborted } from "./abort.js";

describe("untilAborted", () => {
  it("passes the result through when nothing aborts", async () => {
    await expect(untilAborted(Promise.resolve(7), new AbortController().signal)).resolves.toBe(7);
    await expect(untilAborted(Promise.reject(new Error("tts down")))).rejects.toThrow("tts down");
  });

  it("rejects as soon as the signal aborts, without waiting for the work", async () => {
    const ac = new AbortController();
    const never = new Promise<number>(() => {});
    const pending = untilAborted(never, ac.signal);
    ac.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("rejects right away when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("too late"));
    await expect(untilAborted(Promise.reject(new Error("ignored")), ac.signal)).rejects.toThrow("too late");
  });
});
