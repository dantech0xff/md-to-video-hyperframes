/**
 * Messages between the main process and the engine host (a utility process
 * that runs the engine: Studio tools, storyboards, renders, the Chrome
 * download). Requests carry an id; the host answers each one once and also
 * pushes events.
 */
import type { Catalog, FormatName, RenderQuality, RenderStatus, StoryboardReview } from "../shared/types";

export interface HostInfo {
  studioUrl: string;
  engineVersion: string;
  chromeBuild: string;
}

export interface RenderRequest {
  dir: string;
  /** relative to the project folder; the job renders the formats it asks for when the job runs */
  script: string;
  quality: RenderQuality;
}

export interface ScriptCheck {
  ok: boolean;
  errors: { path: string; message: string }[];
  formats: FormatName[];
}

export interface HostMethods {
  /** loads the engine from `engineRoot` and starts the Studio tools server */
  init(p: { engineRoot: string }): HostInfo;
  /** sets (string) or removes (null) environment variables the engine reads: voices, keys, FFmpeg, Chrome */
  setEnv(p: { env: Record<string, string | null> }): void;
  /** gives the project its own Studio tools token */
  openProject(p: { dir: string }): { token: string };
  closeProject(p: { token: string }): void;
  checkScript(p: { dir: string; script: string }): ScriptCheck;
  review(p: { dir: string; script: string; format: FormatName }): StoryboardReview;
  catalog(): Catalog;
  checkFfmpeg(): { ffmpeg: string; ffprobe: string };
  /** the pinned Chrome in `cacheDir`, downloaded first when `install` */
  chrome(p: { cacheDir: string; install: boolean }): { path?: string; build: string };
  render(p: RenderRequest): { jobId: string };
  cancel(p: { jobId: string }): void;
}

export type HostMethod = keyof HostMethods;
export type HostParams<M extends HostMethod> = Parameters<HostMethods[M]>[0];
export type HostResult<M extends HostMethod> = ReturnType<HostMethods[M]>;

export type HostEvent =
  | {
      type: "render";
      jobId: string;
      status: RenderStatus;
      /** the formats the job renders, from the script as the job read it */
      formats?: FormatName[];
      format?: FormatName;
      stage?: string;
      percent?: number;
      error?: string;
      outputs?: { format: FormatName; video: string }[];
    }
  | { type: "chrome"; percent: number };

export type ToHost = { kind: "request"; id: number; method: HostMethod; params: unknown };
export type FromHost = { kind: "response"; id: number; result?: unknown; error?: string } | { kind: "event"; event: HostEvent };
