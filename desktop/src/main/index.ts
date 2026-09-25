/**
 * Get Frames main process: sets up the services (settings, engine host, Agent
 * Hub, render queue, setup checks), the window and its bridge. With
 * --smoke-test it checks the build instead (CI) and exits.
 */
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, nativeTheme, Notification, powerSaveBlocker, protocol, safeStorage, shell, utilityProcess } from "electron";
import type { EventChannel, Events } from "../shared/api";
import type { HostEvent } from "../engine/protocol";
import { claudeLaunch } from "./agents/claude-code";
import { AgentHub } from "./agents/hub";
import { EngineClient, type HostPort } from "./engine";
import { registerIpc } from "./ipc";
import { joinPath, loginShellPath, wellKnownDirs, withPath } from "./locate";
import { MEDIA_PRIVILEGES, MEDIA_SCHEME, serveMedia } from "./media";
import { appPaths } from "./paths";
import { ProjectStore } from "./projects";
import { RenderQueue } from "./render";
import { defaultSettings, SettingsStore } from "./settings";
import { Setup } from "./setup";
import { runSmokeTest } from "./smoke";
import { fetchPage } from "./web-page";

const SMOKE = process.argv.includes("--smoke-test");
const mainDir = dirname(fileURLToPath(import.meta.url));

// development and smoke tests never touch the real app data
if (SMOKE) app.setPath("userData", mkdtempSync(join(tmpdir(), "get-frames-smoke-")));
else if (!app.isPackaged) app.setPath("userData", join(app.getPath("appData"), "Get Frames Dev"));

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: MEDIA_PRIVILEGES }]);
// no spell checking: on Windows and Linux every session would download a dictionary from Google
app.on("session-created", (ses) => {
  ses.setSpellCheckerLanguages([]);
  ses.setSpellCheckerEnabled(false);
});

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
else void main();

async function main(): Promise<void> {
  await app.whenReady();
  const paths = appPaths({
    userData: app.getPath("userData"),
    videos: app.getPath("videos"),
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDir,
  });
  for (const dir of [paths.logs, paths.brands, paths.sfx, paths.music, paths.browsers]) mkdirSync(dir, { recursive: true });
  const log = (file: string) => (line: string) => {
    try {
      appendFileSync(join(paths.logs, file), `${new Date().toISOString()} ${line}\n`);
    } catch {
      // logging must never break the app
    }
  };
  const mainLog = log("main.log");
  mainLog(`Get Frames ${app.getVersion()} starting (engine: ${paths.engineRoot})`);

  const settings = new SettingsStore({ settings: paths.settings, secrets: paths.secrets }, safeStorage, defaultSettings(paths.defaultProjectsDir));

  // an app opened from Finder does not have the terminal's PATH
  const shellPath = await loginShellPath();
  const pathValue = joinPath([shellPath, process.env.PATH, wellKnownDirs()]);
  mainLog(`PATH: ${pathValue}`);

  const send = <C extends EventChannel>(channel: C, payload: Events[C]) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
  };

  const engine = new EngineClient({
    engineRoot: paths.engineRoot,
    start: () =>
      forkHost(join(mainDir, "engine-host.js"), paths.userData, log("engine.log"), {
        ...withPath(process.env, pathValue),
        // the executable that runs the HyperFrames CLI as Node
        HYPERFRAMES_NODE: process.execPath,
        BRANDS_DIR: paths.brands,
        SFX_DIR: paths.sfx,
        MUSIC_DIR: paths.music,
      }),
    // events only come once the host runs, after the queue below exists
    onEvent: (e: HostEvent) => {
      if (e.type === "render") renders.onHostEvent(e);
      else if (e.type === "chrome") send("event:setup", { step: "chrome", percent: e.percent });
    },
    // agents hold the old Studio tools URL: their next message reconnects with the new one
    onExit: () => {
      renders.onHostExit();
      void hub.closeAll();
    },
    log: mainLog,
  });
  await engine.setEnv(settings.engineEnv());

  const projects = new ProjectStore({ root: () => settings.get().projectsDir, skillsDir: paths.skills });
  const setup = new Setup({ engine, settings, browsersDir: paths.browsers, pathValue: () => pathValue, emit: (p) => send("event:setup", p) });

  let blocker: number | undefined;
  const renders = new RenderQueue({
    engine,
    projects,
    emit: (job) => send("event:render", job),
    onBusy: (busy) => {
      // the machine must not sleep in the middle of a render
      if (busy && blocker === undefined) blocker = powerSaveBlocker.start("prevent-app-suspension");
      if (!busy && blocker !== undefined) {
        powerSaveBlocker.stop(blocker);
        blocker = undefined;
      }
    },
    onFinished: (job) => {
      send("event:projects", { projectId: job.projectId });
      if (!Notification.isSupported()) return;
      const body = job.status === "done" ? "Render xong" : job.status === "cancelled" ? "Đã huỷ render" : `Render lỗi: ${job.error ?? ""}`;
      new Notification({ title: job.title, body }).show();
    },
  });

  const agentLog = log("agent.log");
  const studioTokens = new Map<string, { url: string; token: string }>();
  const hub = new AgentHub({
    version: app.getVersion(),
    projects,
    // one token per project, kept until the engine host restarts (its URL changes then)
    studio: async (dir) => {
      const info = await engine.ensure();
      const known = studioTokens.get(dir);
      if (known?.url === info.studioUrl) return known;
      const { token } = await engine.call("openProject", { dir });
      const studio = { url: info.studioUrl, token };
      studioTokens.set(dir, studio);
      return studio;
    },
    launch: async (_agent, cwd) => {
      const [status] = await setup.agents();
      if (!status?.installed || !status.path) throw new Error("Chưa cài Claude Code. Cài theo hướng dẫn ở màn hình Cài đặt, rồi thử lại.");
      return claudeLaunch({ claude: status.path, cwd, pathValue, logsDir: join(paths.logs, "claude-agent") });
    },
    emit: (e) => send("event:activity", e),
    log: agentLog,
  });

  const dev = process.env.ELECTRON_RENDERER_URL;
  const rendererFile = join(mainDir, "..", "renderer", "index.html");
  const trusted = (url: string) => (dev ? url.startsWith(dev) : url.startsWith("file://") && decodeURIComponent(new URL(url).pathname).endsWith("/renderer/index.html"));

  protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request, [settings.get().projectsDir, paths.userData]));

  registerIpc({
    info: async () => ({ version: app.getVersion(), platform: process.platform, engineVersion: (await engine.ensure()).engineVersion, userData: paths.userData }),
    settings,
    engine,
    setup,
    projects,
    hub,
    renders,
    fetchPage,
    settingsChanged: async () => {
      await engine.setEnv(settings.engineEnv());
      await setup.ffmpeg();
      await setup.agents(true);
      send("event:projects", {});
    },
    projectsChanged: (projectId) => send("event:projects", { projectId }),
    trusted,
  });

  const createWindow = () => {
    const win = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 1000,
      minHeight: 660,
      show: false,
      title: "Get Frames",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#111318" : "#f6f7f9",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: { preload: paths.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    if (!SMOKE) win.once("ready-to-show", () => win.show());
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (!trusted(url)) event.preventDefault();
    });
    if (dev) void win.loadURL(dev);
    else void win.loadFile(rendererFile);
    return win;
  };

  if (SMOKE) {
    const code = await runSmokeTest({ engine, createWindow, fetchPage });
    engine.stop();
    app.exit(code);
    return;
  }

  createWindow();
  // start the engine now: tool paths are known before the first storyboard or render
  void engine
    .ensure()
    .then(() => Promise.all([setup.ffmpeg(), setup.chrome(false)]))
    .catch((e: Error) => mainLog(`engine start failed: ${e.stack ?? e.message}`));

  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    const rendering = renders.list().some((j) => j.status === "running" || j.status === "queued");
    if (rendering) {
      const choice = dialog.showMessageBoxSync({
        type: "warning",
        buttons: ["Thoát và huỷ render", "Ở lại"],
        defaultId: 1,
        cancelId: 1,
        message: "Đang render video",
        detail: "Thoát bây giờ sẽ huỷ render đang chạy và các video đang chờ.",
      });
      if (choice !== 0) {
        event.preventDefault();
        return;
      }
    }
    quitting = true;
    event.preventDefault();
    void hub.closeAll().finally(() => {
      engine.stop();
      app.quit();
    });
  });
}

/** The engine host as a utility process; its console output goes to engine.log. */
function forkHost(entry: string, cwd: string, log: (line: string) => void, env: NodeJS.ProcessEnv): HostPort {
  const child = utilityProcess.fork(entry, [], { serviceName: "Get Frames Engine", stdio: "pipe", cwd, env: env as Record<string, string> });
  child.stdout?.on("data", (d: Buffer) => log(d.toString().trimEnd()));
  child.stderr?.on("data", (d: Buffer) => log(d.toString().trimEnd()));
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => child.on("message", listener),
    onExit: (listener) => child.on("exit", listener),
    kill: () => void child.kill(),
  };
}
