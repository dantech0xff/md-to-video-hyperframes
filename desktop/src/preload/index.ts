/**
 * The renderer's only way into the app: `window.getFrames`. It can invoke the
 * channels listed in shared/api.ts and listen to their events, nothing else.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { EVENT_CHANNELS, INVOKE_CHANNELS, PICKED_FILE_CHANNEL, type GetFramesApi } from "../shared/api";

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
  // a real file the user dropped or chose: the main process may then import it
  pathForFile: (file) => {
    const path = webUtils.getPathForFile(file);
    if (path) ipcRenderer.send(PICKED_FILE_CHANNEL, path);
    return path;
  },
};

contextBridge.exposeInMainWorld("getFrames", api);
