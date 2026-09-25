/** The main process's side of window.getFrames: one handler per channel in shared/api.ts. */
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import { INVOKE_CHANNELS, PICKED_FILE_CHANNEL, type InvokeChannel, type Invokes } from "../shared/api";
import type { AppInfo } from "../shared/types";
import type { AgentHub } from "./agents/hub";
import type { EngineClient } from "./engine";
import { isInside } from "./fs-guard";
import { videoTargets, type ProjectStore } from "./projects";
import { firstPrompt, notesPrompt } from "./prompts";
import type { RenderQueue } from "./render";
import { unpickedPaths, type SettingsStore } from "./settings";
import type { Setup } from "./setup";
import { importSources, type PageFetcher } from "./sources";

export interface Services {
  info(): Promise<AppInfo>;
  settings: SettingsStore;
  engine: EngineClient;
  setup: Setup;
  projects: ProjectStore;
  hub: AgentHub;
  renders: RenderQueue;
  fetchPage: PageFetcher;
  /** after Settings changed: new voices and keys for the engine, new tool paths */
  settingsChanged(): Promise<void>;
  projectsChanged(projectId?: string): void;
  /** does the message come from the app's own page? */
  trusted(event: Sender): boolean;
}

export type Sender = Pick<IpcMainEvent, "sender" | "senderFrame">;

/**
 * The message comes from the top frame of one of the app's windows, showing
 * the app's own page: not from another window or a frame inside a page, even
 * one that loaded the same URL.
 */
export function isAppFrame(e: Sender, windows: ReadonlySet<WebContents>, isAppPage: (url: string) => boolean): boolean {
  const frame = e.senderFrame;
  return !!frame && windows.has(e.sender) && frame.frameTreeNodeId === e.sender.mainFrame.frameTreeNodeId && isAppPage(frame.url);
}

type Handlers = { [C in InvokeChannel]: (...args: Parameters<Invokes[C]>) => ReturnType<Invokes[C]> | Promise<ReturnType<Invokes[C]>> };

export function registerIpc(s: Services): void {
  const window = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined;
  let current: IpcMainInvokeEvent | undefined;
  /** folders and files the user picked in a native dialog (or dropped): the only paths settings may point at and projects may import */
  const picked = new Set<string>();

  const target = async (id: string, video: string) => {
    const project = await s.projects.read(id);
    const t = videoTargets(project.kind).find((v) => v.id === video);
    if (!t) throw new Error(`Dự án không có video "${video}"`);
    return t;
  };

  /** A file of the project, refused when it resolves outside the project folder. */
  const projectFile = (id: string, rel: string) => {
    const dir = s.projects.dir(id);
    const path = join(dir, rel);
    if (!isInside(dir, path)) throw new Error("Đường dẫn nằm ngoài thư mục dự án");
    return path;
  };

  const handlers: Handlers = {
    "app:info": () => s.info(),
    "app:open-external": async (url) => {
      if (!/^https:\/\//i.test(url)) throw new Error("Chỉ mở link https");
      await shell.openExternal(url);
    },
    "setup:status": () => s.setup.status(),
    "setup:install-chrome": () => s.setup.installChrome(),
    "setup:finish": () => {
      s.settings.save({ settings: { setupDone: true } });
    },
    "settings:get": () => s.settings.view(),
    "settings:save": async (patch) => {
      const [stray] = unpickedPaths(patch, s.settings.get(), picked);
      if (stray !== undefined) throw new Error(`Hãy chọn "${stray}" bằng nút chọn thư mục hoặc chọn file.`);
      const next = patch.settings?.projectsDir;
      const moving = next !== undefined && next !== s.settings.get().projectsDir;
      // an agent or a render works on a project of this folder until it is done
      const rendering = s.renders.list().some((j) => j.status === "queued" || j.status === "running");
      if (moving && (s.hub.busy() || rendering)) throw new Error("Agent hoặc render đang làm việc trong thư mục dự án hiện tại. Chờ xong (hoặc bấm Dừng) rồi đổi thư mục.");
      const view = s.settings.save(patch);
      if (moving) {
        // the sessions belong to the projects of the old folder: they stop, their logs stay there
        await s.hub.closeAll();
        s.hub.forget();
      }
      await s.settingsChanged();
      return view;
    },
    "dialog:folder": async (title) => {
      const win = current && window(current);
      const opts = { title, properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      const dir = res.canceled ? null : (res.filePaths[0] ?? null);
      if (dir) picked.add(dir);
      return dir;
    },
    "dialog:files": async (title, extensions) => {
      const win = current && window(current);
      const opts = {
        title,
        properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
        filters: extensions.length ? [{ name: extensions.join(", "), extensions }] : [],
      };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      const files = res.canceled ? [] : res.filePaths;
      for (const file of files) picked.add(file);
      return files;
    },
    "catalog:get": () => s.engine.call("catalog", undefined),
    "projects:list": () => s.projects.list((id) => s.hub.state(id)),
    "projects:create": async (req) => {
      const stray = req.files.find((file) => !picked.has(file));
      if (stray !== undefined) throw new Error(`Hãy chọn "${basename(stray)}" bằng nút chọn tư liệu.`);
      // the agent picked for this video, else the default from Settings
      const id = await s.projects.create({ ...req, agent: req.agent ?? s.settings.get().agent }, (dir) => importSources(dir, req, s.fetchPage));
      s.projectsChanged(id);
      return s.projects.summary(id, "idle");
    },
    "projects:get": (id) => s.projects.detail(id, s.hub.state(id), (dir, script) => s.engine.call("checkScript", { dir, script })),
    "projects:reveal": async (id, rel) => {
      const path = rel ? projectFile(id, rel) : s.projects.dir(id);
      if (rel) shell.showItemInFolder(path);
      else await shell.openPath(path);
    },
    "projects:read-text": async (id, rel) => {
      const path = projectFile(id, rel);
      if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error("File quá lớn để hiển thị");
      return readFile(path, "utf8");
    },
    "agent:activity": (id) => s.hub.activity(id),
    "agent:start": async (id) => {
      const project = await s.projects.read(id);
      await s.hub.send(id, firstPrompt(project, videoTargets(project.kind)));
      s.projectsChanged(id);
    },
    "agent:send": (id, text) => s.hub.send(id, text),
    "agent:cancel": (id) => s.hub.cancel(id),
    "agent:answer": (id, entryId, optionId) => s.hub.answer(id, entryId, optionId),
    "review:get": async (id, video, format) => {
      const t = await target(id, video);
      return s.engine.call("review", { dir: s.projects.dir(id), script: t.script, format });
    },
    "review:send-notes": async (id, notes) => {
      if (!notes.general.trim() && !notes.scenes.some((n) => n.note.trim())) throw new Error("Chưa có ghi chú nào");
      await s.hub.send(id, notesPrompt(notes, await target(id, notes.video)));
    },
    "render:start": (id, opts) => s.renders.start(id, opts),
    "render:list": () => s.renders.list(),
    "render:cancel": (jobId) => s.renders.cancel(jobId),
  };

  ipcMain.on(PICKED_FILE_CHANNEL, (event, path: unknown) => {
    if (s.trusted(event) && typeof path === "string" && path) picked.add(path);
  });

  for (const channel of INVOKE_CHANNELS) {
    const fn = handlers[channel] as (...args: unknown[]) => unknown;
    ipcMain.handle(channel, async (event, ...args) => {
      if (!s.trusted(event)) throw new Error("Untrusted sender");
      current = event;
      return fn(...args);
    });
  }
}
