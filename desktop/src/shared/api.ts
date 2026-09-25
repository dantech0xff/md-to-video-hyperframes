/**
 * The bridge the preload script exposes to the renderer as `window.getFrames`.
 * Every call is an `ipcRenderer.invoke` on the channel of the same name.
 */
import type {
  ActivityEntry,
  ActivityEvent,
  AgentState,
  AppInfo,
  Catalog,
  FormatName,
  NewProjectRequest,
  ProjectDetail,
  ProjectSummary,
  RenderJob,
  RenderQuality,
  ReviewNotes,
  SettingsPatch,
  SettingsView,
  SetupProgress,
  SetupStatus,
  StoryboardReview,
  VideoTarget,
} from "./types";

export interface Invokes {
  "app:info": () => AppInfo;
  "app:open-external": (url: string) => void;
  "setup:status": () => SetupStatus;
  "setup:install-chrome": () => SetupStatus;
  "setup:finish": () => void;
  "settings:get": () => SettingsView;
  "settings:save": (patch: SettingsPatch) => SettingsView;
  "dialog:folder": (title: string) => string | null;
  "dialog:files": (title: string, extensions: string[]) => string[];
  "catalog:get": () => Catalog;
  "projects:list": () => ProjectSummary[];
  "projects:create": (req: NewProjectRequest) => ProjectSummary;
  "projects:get": (id: string) => ProjectDetail;
  "projects:reveal": (id: string, rel?: string) => void;
  "projects:read-text": (id: string, rel: string) => string;
  "agent:activity": (id: string) => { entries: ActivityEntry[]; state: AgentState };
  "agent:start": (id: string) => void;
  "agent:send": (id: string, text: string) => void;
  "agent:cancel": (id: string) => void;
  "agent:answer": (id: string, entryId: string, optionId: string | null) => void;
  "review:get": (id: string, video: VideoTarget["id"], format: FormatName) => StoryboardReview;
  "review:send-notes": (id: string, notes: ReviewNotes) => void;
  "render:start": (id: string, opts: { videos?: VideoTarget["id"][]; quality: RenderQuality }) => RenderJob[];
  "render:list": () => RenderJob[];
  "render:cancel": (jobId: string) => void;
}

export type InvokeChannel = keyof Invokes;

export interface Events {
  "event:activity": ActivityEvent;
  "event:render": RenderJob;
  "event:setup": SetupProgress;
  "event:projects": { projectId?: string };
}

export type EventChannel = keyof Events;

export const INVOKE_CHANNELS = [
  "app:info",
  "app:open-external",
  "setup:status",
  "setup:install-chrome",
  "setup:finish",
  "settings:get",
  "settings:save",
  "dialog:folder",
  "dialog:files",
  "catalog:get",
  "projects:list",
  "projects:create",
  "projects:get",
  "projects:reveal",
  "projects:read-text",
  "agent:activity",
  "agent:start",
  "agent:send",
  "agent:cancel",
  "agent:answer",
  "review:get",
  "review:send-notes",
  "render:start",
  "render:list",
  "render:cancel",
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = ["event:activity", "event:render", "event:setup", "event:projects"] as const satisfies readonly EventChannel[];

// both lists must name every channel: a missing one fails to compile here
type Missing = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]> | Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>;
export const ALL_CHANNELS_LISTED: [Missing] extends [never] ? true : Missing = true;

/**
 * Sent by the preload itself, never by the page (it is no invoke channel): the
 * path of a file the user dropped or chose, which the page cannot make up.
 */
export const PICKED_FILE_CHANNEL = "files:picked";

export interface GetFramesApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: Parameters<Invokes[C]>): Promise<ReturnType<Invokes[C]>>;
  on<C extends EventChannel>(channel: C, listener: (payload: Events[C]) => void): () => void;
  /** absolute path of a file dropped or picked in the renderer */
  pathForFile(file: File): string;
}
