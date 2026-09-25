/**
 * First-run setup and the checks behind it (design doc §9): Chrome headless
 * downloaded into the app's data folder, FFmpeg found and tried, the agents
 * found with their version and login. The engine gets the paths it needs.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentStatus, SetupProgress, SetupStatus, ToolStatus } from "../shared/types";
import { detectClaude } from "./agents/claude-code";
import type { EngineClient } from "./engine";
import { findOnPath } from "./locate";
import type { SettingsStore } from "./settings";

export interface SetupDeps {
  engine: Pick<EngineClient, "call" | "setEnv">;
  settings: SettingsStore;
  browsersDir: string;
  /** PATH the app searches and gives to the programs it runs */
  pathValue: () => string;
  emit(progress: SetupProgress): void;
}

export class Setup {
  private agentCache?: { at: number; agents: AgentStatus[] };

  constructor(private readonly deps: SetupDeps) {}

  async status(): Promise<SetupStatus> {
    const [chrome, ffmpeg, agents] = await Promise.all([this.chrome(false), this.ffmpeg(), this.agents(true)]);
    const settings = this.deps.settings.get();
    return { chrome, ffmpeg, agents, projectsDir: settings.projectsDir, done: settings.setupDone };
  }

  /** The pinned Chrome headless, downloaded first when `install`. */
  async chrome(install: boolean): Promise<ToolStatus & { build: string }> {
    try {
      const { path, build } = await this.deps.engine.call("chrome", { cacheDir: this.deps.browsersDir, install });
      await this.deps.engine.setEnv({ HYPERFRAMES_BROWSER_PATH: path ?? null });
      return { ok: !!path, path, build, version: path ? build : undefined };
    } catch (e) {
      return { ok: false, build: "", error: (e as Error).message };
    }
  }

  async installChrome(): Promise<SetupStatus> {
    this.deps.emit({ step: "chrome", percent: 0 });
    const chrome = await this.chrome(true);
    if (!chrome.ok) throw new Error(`Không tải được Chrome headless: ${chrome.error ?? "không rõ lý do"}`);
    return this.status();
  }

  /** FFmpeg from Settings or PATH (ffprobe next to it), tried by the engine. */
  async ffmpeg(): Promise<ToolStatus> {
    const { paths } = this.deps.settings.get();
    const pathValue = this.deps.pathValue();
    const ffmpeg = paths.ffmpeg || findOnPath("ffmpeg", pathValue);
    const sibling = ffmpeg && join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    const ffprobe = paths.ffprobe || (sibling && existsSync(sibling) ? sibling : findOnPath("ffprobe", pathValue));
    await this.deps.engine.setEnv({ FFMPEG_PATH: ffmpeg ?? null, FFPROBE_PATH: ffprobe ?? null });
    if (!ffmpeg) return { ok: false, error: "Không tìm thấy ffmpeg" };
    if (!ffprobe) return { ok: false, path: ffmpeg, error: "Không tìm thấy ffprobe (cài cùng FFmpeg)" };
    try {
      const v = await this.deps.engine.call("checkFfmpeg", undefined);
      return { ok: true, path: ffmpeg, version: v.ffmpeg.replace(/^ffmpeg version\s+/, "").split(/\s/)[0] };
    } catch (e) {
      return { ok: false, path: ffmpeg, error: (e as Error).message };
    }
  }

  /** Installed agents; `fresh` re-runs the checks (they take a second or two). */
  async agents(fresh = false): Promise<AgentStatus[]> {
    if (!fresh && this.agentCache && Date.now() - this.agentCache.at < 60_000) return this.agentCache.agents;
    const agents = [await detectClaude(this.deps.pathValue(), this.deps.settings.get().paths.claude)];
    this.agentCache = { at: Date.now(), agents };
    return agents;
  }
}
