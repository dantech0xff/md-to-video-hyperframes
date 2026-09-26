/**
 * The bridge the preload script exposes to the renderer as `window.getFrames`.
 * Every call is an `ipcRenderer.invoke` on the channel of the same name.
 */
import type {
  ActivityEntry,
  ActivityEvent,
  AgentState,
  AppInfo,
  BrandKitEdit,
  BrandKitFile,
  Catalog,
  FormatName,
  Library,
  NewProjectRequest,
  PartEdit,
  ProjectDetail,
  ProjectSummary,
  RenderJob,
  RenderQuality,
  ReviewNotes,
  SaveBrandResult,
  SavePartResult,
  ScriptPart,
  SettingsPatch,
  SettingsView,
  SetupProgress,
  SetupStatus,
  SoundKind,
  StoryboardJob,
  StoryboardReview,
  StyleSounds,
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
  "library:get": () => Library;
  "library:brand": (id: string) => BrandKitFile;
  /** a new kit of the user's named `name`, a copy of kit `from` or a blank one; its id */
  "library:create-brand": (name: string, from?: string) => string;
  /** the user's own copy of a bundled kit, under its id: it replaces the bundled one */
  "library:customize-brand": (id: string) => void;
  "library:save-brand": (id: string, edit: BrandKitEdit) => SaveBrandResult;
  /** moves a kit of the user's to the trash */
  "library:delete-brand": (id: string) => void;
  /** copies audio files the user picked into the library, in folder `category` ("" for the top); their names */
  "library:import-sounds": (kind: SoundKind, files: string[], category: string) => string[];
  /** renames a sound file (its extension kept); its new name */
  "library:rename-sound": (kind: SoundKind, file: string, name: string) => string;
  "library:delete-sound": (kind: SoundKind, file: string) => void;
  /** makes the placeholder sounds (`_starter/`); how many were made */
  "library:starter-sounds": () => number;
  "library:style-sounds": (style: string) => StyleSounds;
  /** opens the library folder, or a kit's */
  "library:reveal": (folder: "brands" | SoundKind, brandId?: string) => void;
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
  "script:part": (id: string, video: VideoTarget["id"], key: string) => ScriptPart;
  /** refused while the agent works on the project; a change rebuilds the video's storyboard */
  "script:save-part": (id: string, video: VideoTarget["id"], edit: PartEdit) => SavePartResult;
  "storyboard:list": (id: string) => StoryboardJob[];
  "storyboard:build": (id: string, video: VideoTarget["id"]) => StoryboardJob;
  "storyboard:cancel": (projectId: string, jobId: string) => void;
  "render:start": (id: string, opts: { videos?: VideoTarget["id"][]; quality: RenderQuality }) => RenderJob[];
  "render:list": () => RenderJob[];
  "render:cancel": (jobId: string) => void;
}

export type InvokeChannel = keyof Invokes;

export interface Events {
  "event:activity": ActivityEvent;
  "event:render": RenderJob;
  "event:storyboard": StoryboardJob;
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
  "library:get",
  "library:brand",
  "library:create-brand",
  "library:customize-brand",
  "library:save-brand",
  "library:delete-brand",
  "library:import-sounds",
  "library:rename-sound",
  "library:delete-sound",
  "library:starter-sounds",
  "library:style-sounds",
  "library:reveal",
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
  "script:part",
  "script:save-part",
  "storyboard:list",
  "storyboard:build",
  "storyboard:cancel",
  "render:start",
  "render:list",
  "render:cancel",
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = ["event:activity", "event:render", "event:storyboard", "event:setup", "event:projects"] as const satisfies readonly EventChannel[];

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
