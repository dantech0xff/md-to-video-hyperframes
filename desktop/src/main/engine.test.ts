import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { FromHost, HostEvent, ToHost } from "../engine/protocol";
import { EngineClient, type HostPort } from "./engine";

/** A host that answers like the real one, and can crash. */
function fakeHost(answer: (m: ToHost) => unknown) {
  const hosts: { port: HostPort; sent: ToHost[]; crash(code?: number): void; emit(e: HostEvent): void }[] = [];
  const start = () => {
    const bus = new EventEmitter();
    const sent: ToHost[] = [];
    const port: HostPort = {
      postMessage: (m) => {
        sent.push(m);
        queueMicrotask(() => {
          try {
            bus.emit("message", { kind: "response", id: m.id, result: answer(m) } satisfies FromHost);
          } catch (e) {
            bus.emit("message", { kind: "response", id: m.id, error: (e as Error).message } satisfies FromHost);
          }
        });
      },
      onMessage: (l) => void bus.on("message", l),
      onExit: (l) => void bus.on("exit", l),
      kill: () => bus.emit("exit", 0),
    };
    hosts.push({ port, sent, crash: (code = 1) => bus.emit("exit", code), emit: (event) => bus.emit("message", { kind: "event", event }) });
    return port;
  };
  return { hosts, start };
}

describe("EngineClient", () => {
  it("starts the host once, loads the engine and replays the environment", async () => {
    const { hosts, start } = fakeHost((m) => (m.method === "init" ? { studioUrl: "http://127.0.0.1:1/mcp", engineVersion: "2.0.0", chromeBuild: "131" } : { ok: m.method }));
    const client = new EngineClient({ start, engineRoot: "/engine", onEvent: () => undefined });
    await client.setEnv({ VOICE_PROFILE: "free" });
    const [a, b] = await Promise.all([client.call("catalog", undefined), client.call("catalog", undefined)]);
    expect([a, b]).toEqual([{ ok: "catalog" }, { ok: "catalog" }]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].sent.map((m) => m.method)).toEqual(["init", "setEnv", "catalog", "catalog"]);
    expect(hosts[0].sent[0].params).toEqual({ engineRoot: "/engine" });
    expect(hosts[0].sent[1].params).toEqual({ env: { VOICE_PROFILE: "free" } });
  });

  it("sends a change made while the host was starting", async () => {
    const { hosts, start } = fakeHost((m) => (m.method === "init" ? { studioUrl: "", engineVersion: "", chromeBuild: "" } : "ok"));
    const client = new EngineClient({ start, engineRoot: "/e", onEvent: () => undefined });
    await client.setEnv({ VOICE_PROFILE: "free" });
    const starting = client.ensure();
    // hold the answer to the start's copy of the environment, and change it meanwhile
    const post = hosts[0].port.postMessage;
    let held: ToHost | undefined;
    hosts[0].port.postMessage = (m) => {
      if (m.method === "setEnv" && !held) held = m;
      else post(m);
    };
    await vi.waitFor(() => expect(held).toBeDefined());
    const change = client.setEnv({ FFMPEG_PATH: "/opt/homebrew/bin/ffmpeg" });
    post(held!);
    await Promise.all([starting, change]);
    expect(hosts[0].sent.map((m) => m.method)).toEqual(["init", "setEnv", "setEnv"]);
    expect(hosts[0].sent[1].params).toEqual({ env: { VOICE_PROFILE: "free" } });
    expect(hosts[0].sent[2].params).toEqual({ env: { FFMPEG_PATH: "/opt/homebrew/bin/ffmpeg" } });
  });

  it("passes errors and events on", async () => {
    const events: HostEvent[] = [];
    const { hosts, start } = fakeHost((m) => {
      if (m.method === "render") throw new Error("script.json is invalid");
      return { studioUrl: "", engineVersion: "", chromeBuild: "" };
    });
    const client = new EngineClient({ start, engineRoot: "/e", onEvent: (e) => events.push(e) });
    await expect(client.call("render", { dir: "/p", script: "script.json", formats: ["landscape"], quality: "draft" })).rejects.toThrow("script.json is invalid");
    hosts[0].emit({ type: "chrome", percent: 42 });
    expect(events).toEqual([{ type: "chrome", percent: 42 }]);
  });

  it("fails pending calls when the host dies, and starts a new one next time", async () => {
    const onExit = vi.fn();
    const { hosts, start } = fakeHost((m) => (m.method === "init" ? { studioUrl: "", engineVersion: "", chromeBuild: "" } : "ok"));
    const client = new EngineClient({ start, engineRoot: "/e", onEvent: () => undefined, onExit });
    await client.setEnv({ FFMPEG_PATH: "/usr/bin/ffmpeg" });
    await client.ensure();
    // a request the host never answers
    const pending = new Promise((resolve, reject) => {
      hosts[0].port.postMessage = () => undefined;
      client.call("checkFfmpeg", undefined).then(resolve, reject);
    });
    await Promise.resolve();
    hosts[0].crash(9);
    await expect(pending).rejects.toThrow(/Engine đã dừng/);
    expect(onExit).toHaveBeenCalledWith(9);

    await client.setEnv({ VOICE_PROFILE: "clone" });
    expect(await client.call("checkFfmpeg", undefined)).toBe("ok");
    expect(hosts).toHaveLength(2);
    // the new host gets everything set so far
    expect(hosts[1].sent[1]).toMatchObject({ method: "setEnv", params: { env: { FFMPEG_PATH: "/usr/bin/ffmpeg", VOICE_PROFILE: "clone" } } });
  });
});
