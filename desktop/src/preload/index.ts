/**
 * The renderer's only way into the app: `window.getFrames`. It can invoke the
 * channels listed in shared/api.ts and listen to their events, nothing else.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { EVENT_CHANNELS, INVOKE_CHANNELS, type GetFramesApi } from "../shared/api";

const invokes = new Set<string>(INVOKE_CHANNELS);
const events = new Set<string>(EVENT_CHANNELS);

const api: GetFramesApi = {
  invoke(channel, ...args) {
    if (!invokes.has(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!events.has(channel)) throw new Error(`Unknown event: ${channel}`);
    const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, handler);
    return () => void ipcRenderer.removeListener(channel, handler);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("getFrames", api);
