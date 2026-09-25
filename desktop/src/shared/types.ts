/**
 * Data shared by the main process, the preload bridge and the renderer. Plain
 * JSON only: everything here crosses IPC.
 */

export type FormatName = "landscape" | "portrait";
export type AgentId = "claude-code";
export type VoiceProfile = "free" | "clone";
export type CloneProvider = "elevenlabs" | "lucylab";
export type RenderQuality = "draft" | "standard" | "high";

// ── setup and settings ─────────────────────────────────────────────────────

export interface AgentStatus {
  id: AgentId;
  name: string;
  installed: boolean;
  /** the executable the app will run */
  path?: string;
  version?: string;
  /** true / false when known, null when the agent could not tell */
  loggedIn: boolean | null;
  /** e.g. "Claude Max · dan@example.com" */
  account?: string;
  error?: string;
  installUrl: string;
  /** what to run in a terminal to log in */
  loginCommand: string;
}

export interface ToolStatus {
  ok: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface SetupStatus {
  chrome: ToolStatus & { build: string };
  ffmpeg: ToolStatus;
  agents: AgentStatus[];
  projectsDir: string;
  /** the user went through the setup screen once */
  done: boolean;
}

export interface VoiceSettings {
  profile: VoiceProfile;
  /** Edge TTS voice of the free profile */
  freeVoice: string;
  cloneProvider: CloneProvider;
  elevenlabsVoiceId: string;
  elevenlabsModelId: string;
  lucylabVoiceId: string;
  vbeeAppId: string;
  vbeeVoiceCode: string;
}

export interface Settings {
  projectsDir: string;
  agent: AgentId;
  voice: VoiceSettings;
  /** explicit executables; empty means found automatically */
  paths: { ffmpeg: string; ffprobe: string; claude: string };
  setupDone: boolean;
}

export const SECRET_KEYS = ["elevenlabsApiKey", "lucylabApiKey", "vbeeAccessToken"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** Settings as the renderer sees them: whether each secret is set, never its value. */
export interface SettingsView extends Settings {
  secrets: Record<SecretKey, boolean>;
  /** false when the OS keychain is unavailable and secrets cannot be saved */
  encryption: boolean;
}

export interface SettingsPatch {
  settings?: {
    projectsDir?: string;
    agent?: AgentId;
    voice?: Partial<VoiceSettings>;
    paths?: Partial<Settings["paths"]>;
    setupDone?: boolean;
  };
  /** a string sets the secret, null deletes it */
  secrets?: Partial<Record<SecretKey, string | null>>;
}

export interface Catalog {
  styles: { id: string; name: string }[];
  brands: { id: string; name?: string }[];
  voices: {
    default: VoiceProfile;
    free: { available: boolean; provider: string; voice: string };
    clone: { available: boolean; provider: string };
  };
  sfx: string[];
  music: string[];
}

export interface AppInfo {
  version: string;
  platform: string;
  engineVersion: string;
  userData: string;
}

// ── projects ───────────────────────────────────────────────────────────────

/** lesson: a 16:9 lesson plus a 9:16 Short; short: only a Short. */
export type VideoKind = "lesson" | "short";

export interface VideoTarget {
  id: "main" | "short";
  label: string;
  /** relative to the project folder */
  script: string;
  youtube: string;
}

export interface SourceRef {
  /** relative to the project folder */
  file: string;
  origin: "file" | "url" | "text";
  url?: string;
  title?: string;
}

export interface ProjectRequest {
  topic: string;
  notes: string;
  /** a style id, or "" to let the agent pick */
  style: string;
  voice: VoiceProfile;
}

/** project.json */
export interface ProjectFile {
  version: 1;
  title: string;
  kind: VideoKind;
  request: ProjectRequest;
  sources: SourceRef[];
  agent: { id: AgentId; sessionId?: string };
  createdAt: string;
  updatedAt: string;
}

export type ProjectStage = "new" | "writing" | "review" | "rendered";
export type AgentState = "idle" | "working" | "waiting" | "error";

export interface ProjectSummary {
  /** folder name */
  id: string;
  dir: string;
  title: string;
  kind: VideoKind;
  stage: ProjectStage;
  agentState: AgentState;
  updatedAt: string;
  /** first storyboard frame, when there is one */
  thumbnail?: string;
}

export interface FormatState {
  format: FormatName;
  storyboard?: string;
  video?: string;
  duration?: number;
  captions?: string;
  chapters?: string;
}

export interface VideoState extends VideoTarget {
  exists: boolean;
  valid: boolean;
  errors: { path: string; message: string }[];
  /** formats the script asks for */
  formats: FormatState[];
  youtubeExists: boolean;
}

export interface ProjectDetail extends ProjectSummary {
  request: ProjectRequest;
  sources: SourceRef[];
  videos: VideoState[];
}

export interface NewProjectRequest {
  title: string;
  kind: VideoKind;
  notes: string;
  style: string;
  voice: VoiceProfile;
  files: string[];
  urls: string[];
  /** pasted text, saved as sources/notes.md */
  text: string;
}

// ── storyboard review ──────────────────────────────────────────────────────

export interface StoryboardScene {
  index: number;
  key: string;
  kind: "scene" | "intro" | "chapter" | "outro";
  type: string;
  chapter: string;
  voice: string;
  start?: number;
  end?: number;
  shot?: string;
}

export interface StoryboardReview {
  format: FormatName;
  storyboard?: string;
  duration?: number;
  stale: boolean;
  scenes: StoryboardScene[];
}

export interface ReviewNotes {
  video: VideoTarget["id"];
  format: FormatName;
  general: string;
  scenes: { key: string; note: string }[];
}

// ── agent activity ─────────────────────────────────────────────────────────

export interface PermissionOption {
  id: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export type ActivityEntry = { id: string; at: string } & (
  | { kind: "user"; text: string }
  | { kind: "message" | "thought"; text: string }
  | { kind: "tool"; title: string; status: "pending" | "running" | "done" | "failed"; toolKind?: string; files?: string[] }
  | { kind: "plan"; steps: { title: string; status: "pending" | "in_progress" | "completed" }[] }
  | { kind: "permission"; title: string; detail?: string; options: PermissionOption[]; answer?: string; auto?: boolean }
  | { kind: "notice"; level: "info" | "warning" | "error"; text: string }
  | { kind: "end"; reason: "done" | "cancelled" | "error" | "refusal" | "limit"; error?: string }
);

export type ActivityEvent =
  | { projectId: string; type: "entry"; entry: ActivityEntry }
  | { projectId: string; type: "state"; state: AgentState };

// ── render queue ───────────────────────────────────────────────────────────

export type RenderStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface RenderJob {
  id: string;
  projectId: string;
  title: string;
  video: VideoTarget["id"];
  formats: FormatName[];
  quality: RenderQuality;
  status: RenderStatus;
  /** the format being rendered and its progress */
  format?: FormatName;
  stage?: string;
  percent: number;
  error?: string;
  outputs: { format: FormatName; video: string }[];
  queuedAt: string;
  finishedAt?: string;
}

export interface SetupProgress {
  step: "chrome";
  percent: number;
}
