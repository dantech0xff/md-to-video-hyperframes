import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentState, NewProjectRequest, ProjectFile } from "../shared/types";

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

import type { WebContents } from "electron";
import { PICKED_FILE_CHANNEL } from "../shared/api";
import { defaultSettings } from "./settings";
import { isAppFrame, registerIpc, type Sender, type Services } from "./ipc";

const APP = "file:///app/renderer/index.html";
const fromApp = { senderFrame: { url: APP }, sender: {} };
const fromElsewhere = { senderFrame: { url: "https://evil.example/" }, sender: {} };
const call = (channel: string, ...args: unknown[]) => electron.handlers.get(channel)!(fromApp, ...args);

const request = (files: string[]): NewProjectRequest => ({ title: "Kotlin Flow", kind: "short", notes: "", style: "", voice: "free", files, urls: [], text: "" });

const ID = "2026-09-25-kotlin-flow";

function services() {
  let settings = defaultSettings("/Users/dan/Movies/Get Frames");
  const library = {
    saveBrand: vi.fn(async () => ({ ok: true, issues: [] })),
    deleteBrand: vi.fn(async () => undefined),
    importSounds: vi.fn(async () => ["whoosh"]),
  };
  const created: NewProjectRequest[] = [];
  const project = { kind: "lesson", agent: { id: "claude-code" } } as ProjectFile;
  const s = {
    settings: {
      get: () => settings,
      save: vi.fn((patch: { settings?: { projectsDir?: string; brand?: string } }) => {
        settings = { ...settings, ...(patch.settings?.projectsDir ? { projectsDir: patch.settings.projectsDir } : {}), ...(patch.settings?.brand ? { brand: patch.settings.brand } : {}) };
        return settings;
      }),
    },
    projects: {
      create: vi.fn(async (req: NewProjectRequest) => {
        created.push(req);
        return "2026-09-25-kotlin-flow";
      }),
      summary: async (id: string) => ({ id }),
      read: async () => project,
      dir: (id: string) => `/Users/dan/Movies/Get Frames/${id}`,
      update: vi.fn(async (_id: string, change: (p: ProjectFile) => void) => {
        change(project);
        return project;
      }),
    },
    hub: {
      busy: vi.fn(() => false),
      closeAll: vi.fn(async () => undefined),
      forget: vi.fn(),
      state: vi.fn((_id: string): AgentState => "idle"),
      whileAgentRests: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
    },
    engine: { call: vi.fn(async (_method: string, _params: unknown): Promise<unknown> => undefined) },
    renders: { list: vi.fn((): { status: string }[] => []) },
    storyboards: { list: vi.fn((): { status: string }[] => []), start: vi.fn(async () => ({})), cancel: vi.fn(async () => undefined) },
    library,
    settingsChanged: async () => undefined,
    projectsChanged: () => undefined,
    trusted: (e: { senderFrame: { url: string } | null }) => e.senderFrame?.url === APP,
  };
  registerIpc(s as unknown as Services);
  return { s, created, project };
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

  it("moves to another projects folder only while no agent or render works in this one", async () => {
    const { s } = services();
    electron.dialog = { canceled: false, filePaths: ["/Volumes/Work/Videos"] };
    await call("dialog:folder", "Thư mục chứa dự án video");
    s.hub.busy.mockReturnValue(true);
    await expect(call("settings:save", { settings: { projectsDir: "/Volumes/Work/Videos" } })).rejects.toThrow(/đang làm việc/);
    s.hub.busy.mockReturnValue(false);
    s.renders.list.mockReturnValue([{ status: "running" }]);
    await expect(call("settings:save", { settings: { projectsDir: "/Volumes/Work/Videos" } })).rejects.toThrow(/đang làm việc/);
    expect(s.settings.get().projectsDir).toBe("/Users/dan/Movies/Get Frames");
    // other settings save as usual meanwhile
    await call("settings:save", { settings: { voice: { profile: "clone" } } });
    expect(s.hub.forget).not.toHaveBeenCalled();

    // a storyboard the app builds after an edit writes into a project of this folder too
    s.renders.list.mockReturnValue([{ status: "done" }]);
    s.storyboards.list.mockReturnValue([{ status: "queued" }]);
    await expect(call("settings:save", { settings: { projectsDir: "/Volumes/Work/Videos" } })).rejects.toThrow(/đang làm việc/);
    s.storyboards.list.mockReturnValue([{ status: "cancelled" }]);
    await call("settings:save", { settings: { projectsDir: "/Volumes/Work/Videos" } });
    expect(s.settings.get().projectsDir).toBe("/Volumes/Work/Videos");
    // the old folder's sessions stop and are forgotten: a project is read from the new folder next
    expect(s.hub.closeAll).toHaveBeenCalled();
    expect(s.hub.forget).toHaveBeenCalled();
  });

  it("answers no page but the app's own", async () => {
    services();
    await expect(electron.handlers.get("settings:get")!(fromElsewhere)).rejects.toThrow(/Untrusted sender/);
  });
});

describe("IPC: editing a script in the storyboard review", () => {
  beforeEach(() => electron.handlers.clear());
  const edit = { key: "hook", version: "v1", value: { voice: "Flow là luồng dữ liệu.", title: "Flow" } };

  it("saves while the agent rests, then tells the agent and builds the storyboard again", async () => {
    const { s, project } = services();
    s.engine.call.mockResolvedValue({ ok: true, version: "v2", changed: true });
    // the hub refuses while the agent works or waits for the user
    s.hub.whileAgentRests.mockRejectedValueOnce(new Error("Agent đang làm việc trên video này."));
    await expect(call("script:save-part", ID, "short", edit)).rejects.toThrow(/Agent đang làm việc/);
    expect(s.engine.call).not.toHaveBeenCalled();
    expect(s.storyboards.start).not.toHaveBeenCalled();

    expect(await call("script:save-part", ID, "short", edit)).toEqual({ ok: true, version: "v2", changed: true });
    expect(s.engine.call).toHaveBeenCalledWith("savePart", { dir: `/Users/dan/Movies/Get Frames/${ID}`, script: "short/script.json", edit });
    await call("script:save-part", ID, "short", { ...edit, key: "s3" });
    await call("script:save-part", ID, "short", edit);
    expect(project.agent.edited).toEqual({ "short/script.json": ["hook", "s3"] });
    expect(s.storyboards.start).toHaveBeenCalledWith(ID, expect.objectContaining({ id: "short", script: "short/script.json" }));
  });

  it("writes the script and notes the edit while the hub holds the agent's next message, then builds the storyboard", async () => {
    const { s, project } = services();
    const order: string[] = [];
    s.hub.whileAgentRests.mockImplementation(async (_id, fn) => {
      order.push("hold");
      const res = await fn();
      order.push("release");
      return res;
    });
    s.engine.call.mockImplementation(async (method) => {
      order.push(method);
      return { ok: true, version: "v2", changed: true };
    });
    s.projects.update.mockImplementation(async (_id, change) => {
      order.push("edited");
      change(project);
      return project;
    });
    s.storyboards.start.mockImplementation(async () => {
      order.push("storyboard");
      return {};
    });
    await call("script:save-part", ID, "short", edit);
    expect(order).toEqual(["hold", "savePart", "edited", "release", "storyboard"]);
  });

  it("leaves the agent and the storyboard alone when nothing was written", async () => {
    const { s, project } = services();
    s.engine.call.mockResolvedValueOnce({ ok: true, version: "v1", changed: false });
    await call("script:save-part", ID, "main", edit);
    s.engine.call.mockResolvedValueOnce({ ok: false, errors: [{ path: "title", message: "Too big" }], others: [] });
    expect(await call("script:save-part", ID, "main", edit)).toMatchObject({ ok: false });
    expect(project.agent.edited).toBeUndefined();
    expect(s.projects.update).not.toHaveBeenCalled();
    expect(s.storyboards.start).not.toHaveBeenCalled();
  });

  it("reads the parts of the project's own videos only", async () => {
    const { s } = services();
    await call("script:part", ID, "main", "outro");
    expect(s.engine.call).toHaveBeenCalledWith("readPart", { dir: `/Users/dan/Movies/Get Frames/${ID}`, script: "script.json", key: "outro" });
    await expect(call("script:part", ID, "extra", "outro")).rejects.toThrow(/không có video "extra"/);
  });
});

describe("IPC: who may use the bridge", () => {
  const appWindow = { mainFrame: { frameTreeNodeId: 1, url: APP } };
  const windows = new Set([appWindow as unknown as WebContents]);
  const isAppPage = (url: string) => url === APP;
  const event = (sender: object, frame: object | null) => ({ sender, senderFrame: frame }) as unknown as Sender;

  it("is the app's own page, in the top frame of one of the app's windows", () => {
    expect(isAppFrame(event(appWindow, appWindow.mainFrame), windows, isAppPage)).toBe(true);
  });

  it("is not a frame inside the page, another window or another page, whatever URL it shows", () => {
    // an iframe that loaded the app's own file
    expect(isAppFrame(event(appWindow, { frameTreeNodeId: 2, url: APP }), windows, isAppPage)).toBe(false);
    // a window the app did not open as one of its own (the hidden window that reads web pages…)
    const other = { mainFrame: { frameTreeNodeId: 3, url: APP } };
    expect(isAppFrame(event(other, other.mainFrame), windows, isAppPage)).toBe(false);
    // the app's window after it navigated elsewhere, and a frame that is gone
    expect(isAppFrame(event(appWindow, { frameTreeNodeId: 1, url: "https://evil.example/" }), windows, isAppPage)).toBe(false);
    expect(isAppFrame(event(appWindow, null), windows, isAppPage)).toBe(false);
  });
});

describe("IPC: storyboard builds", () => {
  it("stops a build of the project the screen names, never one by its id alone", async () => {
    const { s } = services();
    await call("storyboard:cancel", ID, "storyboard-1");
    expect(s.storyboards.cancel).toHaveBeenCalledWith(ID, "storyboard-1");
  });
});

describe("IPC: the library", () => {
  it("takes images and sounds only from files the user picked", async () => {
    const { s } = services();
    const edit = { value: { name: "Acme" }, images: { "logo.onDark": "/Users/dan/.ssh/id_rsa.png" } };
    await expect(call("library:save-brand", "acme", edit)).rejects.toThrow(/chọn ảnh/);
    await expect(call("library:import-sounds", "sfx", ["/Users/dan/secret.mp3"], "")).rejects.toThrow(/thêm file/);
    expect(s.library.saveBrand).not.toHaveBeenCalled();
    expect(s.library.importSounds).not.toHaveBeenCalled();

    electron.dialog = { canceled: false, filePaths: ["/Users/dan/Pictures/logo.png", "/Users/dan/Music/whoosh.mp3"] };
    await call("dialog:files", "Chọn ảnh", ["png"]);
    await call("library:save-brand", "acme", { value: { name: "Acme" }, images: { "logo.onDark": "/Users/dan/Pictures/logo.png" } });
    expect(s.library.saveBrand).toHaveBeenCalledWith("acme", { value: { name: "Acme" }, images: { "logo.onDark": "/Users/dan/Pictures/logo.png" } });
    await call("library:import-sounds", "sfx", ["/Users/dan/Music/whoosh.mp3"], "transition");
    expect(s.library.importSounds).toHaveBeenCalledWith("sfx", ["/Users/dan/Music/whoosh.mp3"], "transition");
  });

  it("puts the default brand kit back to the bundled one when the user deletes it", async () => {
    const { s } = services();
    s.settings.save({ settings: { brand: "acme" } });
    await call("library:delete-brand", "other");
    expect(s.settings.get().brand).toBe("acme");
    await call("library:delete-brand", "acme");
    expect(s.library.deleteBrand).toHaveBeenCalledWith("acme");
    expect(s.settings.get().brand).toBe("dan-tech");
  });

  it("gives a new video the brand kit picked, else the default, and refuses one that is not an id", async () => {
    const { s, created } = services();
    s.settings.save({ settings: { brand: "acme" } });
    await call("projects:create", request([]));
    await call("projects:create", { ...request([]), brand: "dan-tech" });
    expect(created.map((r) => r.brand)).toEqual(["acme", "dan-tech"]);
    await expect(call("projects:create", { ...request([]), brand: "../x" })).rejects.toThrow(/Không có brand kit/);
  });
});
