/**
 * Entry of the engine host, an Electron utility process: the engine's CPU-heavy
 * work (storyboards, renders) runs here so the window never freezes, and a
 * crash here does not take the app down.
 */
import { createHostService } from "./service";
import type { FromHost, ToHost } from "./protocol";

const port = process.parentPort;
const send = (message: FromHost) => port.postMessage(message);
const service = createHostService((event) => send({ kind: "event", event }));

port.on("message", ({ data }) => {
  const { id, method, params } = data as ToHost;
  service.handle(method, params as never).then(
    (result) => send({ kind: "response", id, result }),
    (err: unknown) => send({ kind: "response", id, error: err instanceof Error ? err.message : String(err) }),
  );
});

process.on("SIGTERM", () => void service.close().finally(() => process.exit(0)));
