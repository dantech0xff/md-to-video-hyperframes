/** Typed access to window.getFrames, with errors the user can read. */
import { useEffect, useRef } from "react";
import type { EventChannel, Events, InvokeChannel, Invokes } from "../../../shared/api";

export async function invoke<C extends InvokeChannel>(channel: C, ...args: Parameters<Invokes[C]>): Promise<Awaited<ReturnType<Invokes[C]>>> {
  try {
    return (await window.getFrames.invoke(channel, ...args)) as Awaited<ReturnType<Invokes[C]>>;
  } catch (e) {
    throw new Error(errorText(e));
  }
}

/** Electron wraps errors from the main process: "Error invoking remote method 'x': Error: message". */
export function errorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}

/** Subscribes for the component's lifetime; the latest listener is always the one called. */
export function useEvent<C extends EventChannel>(channel: C, listener: (payload: Events[C]) => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => window.getFrames.on(channel, (payload) => ref.current(payload)), [channel]);
}
