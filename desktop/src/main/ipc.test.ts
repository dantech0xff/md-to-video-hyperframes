import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NewProjectRequest } from "../shared/types";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

// the IPC handlers as registered, and what the native dialogs answer
const electron = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Handler>(),
  dialog: { canceled: false, filePaths: [] as string[] },
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => electron.handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => electron.listeners.set(channel, fn),
  },
  dialog: { showOpenDialog: async () => electron.dialog },
  shell: { openExternal: async () => undefined, showItemInFolder: () => undefined, openPath: async () => "" },
  BrowserWindow: { fromWebContents: () => null },
}));

import { PICKED_FILE_CHANNEL } from "../shared/api";
import { defaultSettings } from "./settings";
import { registerIpc, type Services } from "./ipc";

const APP = "file:///app/renderer/index.html";
const fromApp = { senderFrame: { url: APP }, sender: {} };
const fromElsewhere = { senderFrame: { url: "https://evil.example/" }, sender: {} };
const call = (channel: string, ...args: unknown[]) => electron.handlers.get(channel)!(fromApp, ...args);

const request = (files: string[]): NewProjectRequest => ({ title: "Kotlin Flow", kind: "short", notes: "", style: "", voice: "free", files, urls: [], text: "" });

function services() {
  let settings = defaultSettings("/Users/dan/Movies/Get Frames");
  const created: NewProjectRequest[] = [];
  const s = {
    settings: {
      get: () => settings,
      save: vi.fn((patch: { settings?: { projectsDir?: string } }) => {
        settings = { ...settings, ...(patch.settings?.projectsDir ? { projectsDir: patch.settings.projectsDir } : {}) };
        return settings;
      }),
    },
    projects: {
      create: vi.fn(async (req: NewProjectRequest) => {
        created.push(req);
        return "2026-09-25-kotlin-flow";
      }),
      summary: async (id: string) => ({ id }),
    },
    settingsChanged: async () => undefined,
    projectsChanged: () => undefined,
    trusted: (url: string) => url === APP,
  };
  registerIpc(s as unknown as Services);
  return { s, created };
}

describe("IPC: paths the user did not pick", () => {
  beforeEach(() => {
    electron.handlers.clear();
    electron.listeners.clear();
    electron.dialog = { canceled: false, filePaths: [] };
  });

  it("imports only files the user picked in the dialog", async () => {
    const { created } = services();
    await expect(call("projects:create", request(["/Users/dan/.ssh/id_rsa.txt"]))).rejects.toThrow(/chọn tư liệu/);
    expect(created).toEqual([]);

    electron.dialog = { canceled: false, filePaths: ["/Users/dan/notes/flow.md"] };
    expect(await call("dialog:files", "Chọn tư liệu", ["md"])).toEqual(["/Users/dan/notes/flow.md"]);
    await call("projects:create", request(["/Users/dan/notes/flow.md"]));
    expect(created.map((r) => r.files)).toEqual([["/Users/dan/notes/flow.md"]]);
  });

  it("takes a dropped file the preload reports, from the app's own page only", async () => {
    const { created } = services();
    const report = electron.listeners.get(PICKED_FILE_CHANNEL)!;
    report(fromElsewhere, "/Users/dan/secret.md");
    await expect(call("projects:create", request(["/Users/dan/secret.md"]))).rejects.toThrow(/chọn tư liệu/);
    report(fromApp, "/Users/dan/Desktop/dropped.pdf");
    await call("projects:create", request(["/Users/dan/Desktop/dropped.pdf"]));
    expect(created).toHaveLength(1);
  });

  it("saves a new projects folder only when the user picked it", async () => {
    const { s } = services();
    await expect(call("settings:save", { settings: { projectsDir: "/" } })).rejects.toThrow(/chọn thư mục/);
    electron.dialog = { canceled: false, filePaths: ["/Volumes/Work/Videos"] };
    await call("dialog:folder", "Thư mục chứa dự án video");
    await call("settings:save", { settings: { projectsDir: "/Volumes/Work/Videos" } });
    expect(s.settings.get().projectsDir).toBe("/Volumes/Work/Videos");
  });

  it("answers no page but the app's own", async () => {
    services();
    await expect(electron.handlers.get("settings:get")!(fromElsewhere)).rejects.toThrow(/Untrusted sender/);
  });
});
