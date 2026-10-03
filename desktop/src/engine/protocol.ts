/**
 * Messages between the main process and the engine host (a utility process
 * that runs the engine: Studio tools, storyboards, renders, the Chrome
 * download). Requests carry an id; the host answers each one once and also
 * pushes events.
 */
import type {
  BrandKitFile,
  Catalog,
  FormatName,
  Library,
  PartAdd,
  PartEdit,
  PartMove,
  PartRemoval,
  RenderMode,
  RenderStatus,
  SavePartResult,
  ScriptPart,
  StoryboardJob,
  StoryboardReview,
  StyleSounds,
} from "../shared/types";

export interface HostInfo {
  studioUrl: string;
  engineVersion: string;
  chromeBuild: string;
}

export interface RenderRequest {
  dir: string;
  /** relative to the project folder; the job renders the formats it asks for when the job runs */
  script: string;
  mode: RenderMode;
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
  /** revokes the project's token and stops its jobs, answering once they have stopped */
  closeProject(p: { token: string }): void;
  checkScript(p: { dir: string; script: string }): ScriptCheck;
  review(p: { dir: string; script: string; format: FormatName }): StoryboardReview;
  /** a scene, chapter card or the outro, by its storyboard key, with the schema of its fields */
  readPart(p: { dir: string; script: string; key: string }): ScriptPart;
  /** writes an edited part back: the whole script must validate, and one changed since it was read is not overwritten */
  savePart(p: { dir: string; script: string; edit: PartEdit }): SavePartResult;
  /** removes a scene (its chapter too when it held only that scene), or switches a chapter's card / the outro off */
  removePart(p: { dir: string; script: string; part: PartRemoval }): SavePartResult;
  /** adds a scene of `part.type` at the end of `part.chapter`, or a chapter at the end of the script */
  addPart(p: { dir: string; script: string; part: PartAdd }): SavePartResult;
  /** adds a copy of the scene `part.key` names, right after it, under an id of its own */
  duplicatePart(p: { dir: string; script: string; part: PartRemoval }): SavePartResult;
  /** moves a scene or a chapter one place in the script's order */
  movePart(p: { dir: string; script: string; part: PartMove }): SavePartResult;
  /** the scene types a new scene may have */
  sceneTypes(): string[];
  /** builds the script's storyboard with its narration, as build_storyboard does; the caller names the job */
  storyboard(p: { dir: string; script: string; jobId: string }): void;
  catalog(): Catalog;
  /** the brand kits in use and the sounds (BRANDS_DIR, SFX_DIR, MUSIC_DIR, then what ships with the engine) */
  library(): Library;
  readBrand(p: { id: string }): BrandKitFile;
  /** what is wrong with `value` as the brand.json of the kit in `dir` (fields, images, default style) */
  checkBrand(p: { dir: string; value: unknown }): { path: string; message: string }[];
  /** the sounds a style's events and music find in the library now */
  styleSounds(p: { style: string }): StyleSounds;
  /** makes the placeholder sounds; how many were made */
  starterSounds(): { made: number };
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
  | ({ type: "storyboard"; jobId: string } & Pick<StoryboardJob, "status" | "step" | "format" | "percent" | "error">)
  | { type: "chrome"; percent: number };

export type ToHost = { kind: "request"; id: number; method: HostMethod; params: unknown };
export type FromHost = { kind: "response"; id: number; result?: unknown; error?: string } | { kind: "event"; event: HostEvent };
