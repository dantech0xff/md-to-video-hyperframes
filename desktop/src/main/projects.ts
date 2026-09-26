/**
 * Project folders (design doc §7): one folder per video project under the
 * projects folder, holding project.json, the material in sources/, what the
 * agent writes and what the engine renders. The app also keeps its own state
 * for the project (the activity log) in .getframes/.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  AgentState,
  FormatName,
  FormatState,
  NewProjectRequest,
  ProjectDetail,
  ProjectFile,
  ProjectStage,
  ProjectSummary,
  SourceRef,
  VideoKind,
  VideoState,
  VideoTarget,
} from "../shared/types";
import { VIDEO_KINDS } from "../shared/types";
import { isAgentId } from "../shared/agents";
import { hasTextMaterial } from "../shared/material";
import { isInside, readFileInside, within, writeFileInside } from "./fs-guard";
import { agentsMd, CLAUDE_MD } from "./prompts";

export const APP_DIR = ".getframes";
const PROJECT_FILE = "project.json";

export function videoTargets(kind: VideoKind): VideoTarget[] {
  if (kind === "lesson") {
    return [
      { id: "main", label: "Bài giảng 16:9", script: "script.json", youtube: "youtube.md" },
      { id: "short", label: "Short 9:16", script: "short/script.json", youtube: "short/youtube.md" },
    ];
  }
  return [{ id: "main", label: kind === "news" ? "Bản tin 9:16" : "Short 9:16", script: "script.json", youtube: "youtube.md" }];
}

/** The formats a video gets unless its script says otherwise. */
function defaultFormats(kind: VideoKind, target: VideoTarget): FormatName[] {
  return kind === "lesson" && target.id === "main" ? ["landscape"] : ["portrait"];
}

/** Lowercase ASCII words joined by dashes, Vietnamese diacritics removed. */
export function slugify(text: string, max = 48): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/, "") || "video";
}

export type ScriptCheck = (dir: string, script: string) => Promise<{ ok: boolean; errors: { path: string; message: string }[]; formats: FormatName[] }>;

export class ProjectStore {
  /** each project's updates of project.json, one after another */
  private readonly updates = new Map<string, Promise<unknown>>();

  constructor(
    private readonly opts: {
      /** the projects folder from Settings */
      root: () => string;
      /** the skills the app ships (.agents/skills of the engine) */
      skillsDir: string;
      now?: () => Date;
    },
  ) {}

  get root(): string {
    return this.opts.root();
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** Folder of a project; the id is a folder name, never a path, and the folder a real one (a link to elsewhere is no project, as in list()). */
  dir(id: string): string {
    if (!id || id === "." || id === ".." || /[\\/:*?"<>|]/.test(id)) throw new Error(`Invalid project id: ${id}`);
    const dir = join(this.root, id);
    if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() || !existsSync(join(dir, PROJECT_FILE))) throw new Error(`No project "${id}" in ${this.root}`);
    return dir;
  }

  async read(id: string): Promise<ProjectFile> {
    // a link the agent left in its place is not followed: the next update would write what it reads back into the project
    const dir = this.dir(id);
    return JSON.parse(await readFileInside(dir, join(dir, PROJECT_FILE))) as ProjectFile;
  }

  /** Changes project.json. Updates of a project run one after another, each on the file the one before wrote. */
  update(id: string, change: (p: ProjectFile) => void): Promise<ProjectFile> {
    const run = (this.updates.get(id) ?? Promise.resolve()).then(async () => {
      const project = await this.read(id);
      change(project);
      project.updatedAt = this.now().toISOString();
      await writeJson(this.dir(id), PROJECT_FILE, project);
      return project;
    });
    const settled = run.catch(() => undefined);
    this.updates.set(id, settled);
    void settled.then(() => {
      if (this.updates.get(id) === settled) this.updates.delete(id);
    });
    return run;
  }

  async list(state: (id: string) => AgentState = () => "idle"): Promise<ProjectSummary[]> {
    if (!existsSync(this.root)) return [];
    const out: ProjectSummary[] = [];
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory() || !existsSync(join(this.root, e.name, PROJECT_FILE))) continue;
      try {
        out.push(await this.summary(e.name, state(e.name)));
      } catch {
        // an unreadable project.json: not a project we can show
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Makes the folder, lets `addSources` fill sources/, writes the agent files
   * and project.json last: until then the folder is not a project (the list
   * skips it). A failure leaves nothing behind.
   */
  async create(req: NewProjectRequest, addSources: (dir: string) => Promise<SourceRef[]>): Promise<string> {
    const title = req.title.trim();
    if (!title) throw new Error("Hãy đặt tên hoặc chủ đề cho video");
    if (!VIDEO_KINDS.includes(req.kind)) throw new Error(`Không có loại video "${String(req.kind)}"`);
    // a news brief tells only what the material says: it needs words to take facts from, pictures only go with them
    if (req.kind === "news" && !hasTextMaterial(req)) {
      throw new Error("Bản tin cần ít nhất một nguồn có chữ: link bài báo, file .md/.txt/.pdf hoặc nội dung dán vào. Ảnh chỉ đi kèm các nguồn đó.");
    }
    const agent = req.agent ?? "claude-code";
    if (!isAgentId(agent)) throw new Error(`Không có agent "${String(agent)}"`);
    await mkdir(this.root, { recursive: true });
    const date = this.now().toISOString().slice(0, 10);
    const base = `${date}-${slugify(title)}`;
    // mkdir fails on a folder that exists: two creations at once never get the same one
    let id = base;
    for (let n = 2; !(await claim(join(this.root, id))); n++) id = `${base}-${n}`;
    const dir = join(this.root, id);
    try {
      await mkdir(join(dir, "sources"));
      const sources = await addSources(dir);
      const now = this.now().toISOString();
      const project: ProjectFile = {
        version: 1,
        title,
        kind: req.kind,
        request: { topic: title, notes: req.notes, style: req.style, voice: req.voice },
        sources,
        agent: { id: agent },
        createdAt: now,
        updatedAt: now,
      };
      await this.writeAgentFiles(dir, project);
      await writeJson(dir, PROJECT_FILE, project);
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
    return id;
  }

  /** AGENTS.md, CLAUDE.md and the shipped skills, rewritten before every agent session. */
  async prepareAgentFiles(id: string): Promise<void> {
    await this.writeAgentFiles(this.dir(id), await this.read(id));
  }

  private async writeAgentFiles(dir: string, project: ProjectFile): Promise<void> {
    // the agent works in this folder: a link it left in place of these files is replaced, never followed
    await writeFileInside(dir, join(dir, "AGENTS.md"), agentsMd(project, videoTargets(project.kind)));
    await writeFileInside(dir, join(dir, "CLAUDE.md"), CLAUDE_MD);
    for (const target of [join(dir, ".agents", "skills"), join(dir, ".claude", "skills")]) {
      // .agents or .claude as a link out of the project would take the removal and the copy there
      if (!isInside(dir, dirname(target))) throw new Error(`${relative(dir, dirname(target))} trong dự án là symlink trỏ ra ngoài thư mục dự án, nên app không ghi skill vào đó. Hãy xoá nó rồi gửi lại.`);
      await rm(target, { recursive: true, force: true });
      await cp(this.opts.skillsDir, target, { recursive: true });
    }
  }

  async summary(id: string, agentState: AgentState): Promise<ProjectSummary> {
    const dir = this.dir(id);
    const project = await this.read(id);
    const read = videoTargets(project.kind).map((t) => this.videoFiles(dir, project.kind, t));
    const videos = read.map((r) => r.video);
    return {
      id,
      dir,
      title: project.title,
      kind: project.kind,
      agent: project.agent.id,
      stage: stageOf(videos, !!project.agent.sessionId),
      agentState,
      updatedAt: latest(dir, project.updatedAt, videos, read.map((r) => r.inputsAt)),
      thumbnail: videos.flatMap((v) => v.formats).map((f) => f.storyboard && join(dirname(f.storyboard), "storyboard", "shot-001.png")).find((p) => p && existsSync(p)),
    };
  }

  /** Everything the project screen shows; `check` validates each script with the engine. */
  async detail(id: string, agentState: AgentState, check: ScriptCheck): Promise<ProjectDetail> {
    const summary = await this.summary(id, agentState);
    const project = await this.read(id);
    const videos: VideoState[] = [];
    for (const t of videoTargets(project.kind)) {
      const exists = existsSync(join(summary.dir, t.script));
      const result = exists ? await check(summary.dir, t.script) : { ok: false, errors: [], formats: [] };
      videos.push({ ...this.videoFiles(summary.dir, project.kind, t, result.formats).video, exists, valid: result.ok, errors: result.errors });
    }
    return { ...summary, stage: stageOf(videos, !!project.agent.sessionId), request: project.request, sources: project.sources, videos };
  }

  /**
   * A video's files, and when its script or an image it shows last changed.
   * `formats`: the formats the engine read in the script; else the script's own list.
   */
  private videoFiles(dir: string, kind: VideoKind, t: VideoTarget, formats?: FormatName[]): { video: VideoState; inputsAt?: number } {
    const script = join(dir, t.script);
    const facts = scriptFacts(script, dir);
    const exists = facts.inputsAt !== undefined;
    const shown = formats?.length ? formats : facts.formats;
    const video: VideoState = {
      ...t,
      exists,
      valid: exists,
      errors: [],
      youtubeExists: existsSync(join(dir, t.youtube)),
      formats: (shown?.length ? shown : defaultFormats(kind, t)).map((format) => formatFiles(format, script, dir, facts)),
    };
    return { video, inputsAt: facts.inputsAt };
  }
}

function formatFiles(format: FormatName, script: string, root: string, facts: ScriptFacts): FormatState {
  const out = join(dirname(script), format);
  const file = (name: string) => (existsSync(join(out, name)) ? join(out, name) : undefined);
  let duration: number | undefined;
  try {
    duration = (JSON.parse(readFileSync(join(out, "plan.json"), "utf8")) as { duration?: number }).duration;
  } catch {
    // no storyboard yet
  }
  const video = file("video.mp4");
  // the script, or an image it shows, changed since the render read them: the video may not show the change
  const videoStale = !!video && !videoCurrent(video, script, root, facts);
  return { format, storyboard: file("storyboard.jpg"), video, videoStale, duration, captions: file("captions.srt"), chapters: file("chapters.txt") };
}

/** The fields that name an image file, by scene type as scripts write it: the ones the engine counts too (src/lesson/inputs.ts). */
export const SCENE_IMAGE_FIELDS: Record<string, string[]> = {
  phone: ["image"],
  image: ["src"],
  "news.breaking": ["image"],
  "news.quote": ["avatar"],
  "news.lower-third": ["media"],
  "3d.phone": ["image"],
};

/** What the screens need from a script without validating it (the project list must stay fast). */
export interface ScriptFacts {
  formats?: FormatName[];
  /**
   * When the script or a local image its scenes show last changed, counted
   * as the engine counts it (an image from its change or replacement time):
   * Infinity when such an image is missing, undefined when there is no script.
   */
  inputsAt?: number;
  /** sha256 of the script's text, as a render's record of it */
  scriptHash?: string;
}

/** `root`: the project folder. An image outside it is never shown (the engine refuses it), so it is not looked up: a network path would reach another machine. */
export function scriptFacts(scriptPath: string, root: string): ScriptFacts {
  const script = statSync(scriptPath, { throwIfNoEntry: false });
  if (!script) return {};
  let text: string;
  try {
    text = readFileSync(scriptPath, "utf8");
  } catch {
    return { inputsAt: script.mtimeMs };
  }
  const scriptHash = createHash("sha256").update(text).digest("hex");
  let raw: { formats?: unknown; chapters?: unknown };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    return { inputsAt: script.mtimeMs, scriptHash };
  }
  const formats = Array.isArray(raw?.formats) ? raw.formats.filter((f): f is FormatName => f === "landscape" || f === "portrait") : undefined;
  let imagesAt = 0;
  const scenes = (Array.isArray(raw?.chapters) ? raw.chapters : []).flatMap((c: { scenes?: unknown }) => (Array.isArray(c?.scenes) ? c.scenes : []));
  for (const scene of scenes as Record<string, unknown>[]) {
    // a field the scene's type does not have is never shown; a type is looked up as the table's own key, never an inherited one ("toString")
    const type = String(scene?.type);
    for (const field of Object.hasOwn(SCENE_IMAGE_FIELDS, type) ? SCENE_IMAGE_FIELDS[type] : []) {
      const value = scene[field];
      // a URL scheme ("https:"), not a Windows drive ("C:\")
      if (typeof value !== "string" || !value || (/^[a-z][a-z\d+.-]*:/i.test(value) && !isAbsolute(value))) continue;
      const path = resolve(dirname(scriptPath), value);
      if (!within(resolve(root), path)) continue;
      const image = statSync(path, { throwIfNoEntry: false });
      imagesAt = image ? Math.max(imagesAt, image.mtimeMs, image.ctimeMs) : Infinity;
    }
  }
  return { formats, inputsAt: Math.max(script.mtimeMs, imagesAt), scriptHash };
}

/**
 * Whether a video shows its script, and the images it shows, as they are now.
 * A render records beside the video what it was made from (video.inputs.json,
 * as the engine writes it): the sha256 of the script's text as the render
 * read it, and each image by its path from the script's folder, with when it
 * last changed as the render read it. A video without that record (an older
 * render's) counts by time: not older than the script or an image.
 */
export function videoCurrent(video: string, script: string, root: string, facts: ScriptFacts): boolean {
  if (facts.inputsAt === undefined) return true;
  let made: { script?: unknown; images?: unknown } | undefined;
  try {
    made = JSON.parse(readFileSync(join(dirname(video), "video.inputs.json"), "utf8")) as typeof made;
  } catch {
    // no record
  }
  const images = made?.images;
  if (typeof made?.script !== "string" || !images || typeof images !== "object" || Array.isArray(images)) return (mtime(video) ?? 0) >= facts.inputsAt;
  if (made.script !== facts.scriptHash) return false;
  return Object.entries(images).every(([path, readAt]) => {
    const image = resolve(dirname(script), path);
    // the record is a file in the project, which the agent can write too: a path outside it is never looked up
    if (typeof readAt !== "number" || !within(resolve(root), image)) return false;
    const now = statSync(image, { throwIfNoEntry: false });
    return !!now && Math.max(now.mtimeMs, now.ctimeMs) <= readAt;
  });
}

function stageOf(videos: VideoState[], hasSession: boolean): ProjectStage {
  const written = videos.filter((v) => v.exists);
  // rendered: every video of the project (a lesson's Short too), in each of its formats, and newer than its script
  if (videos.every((v) => v.exists && v.formats.every((f) => f.video && !f.videoStale))) return "rendered";
  if (written.some((v) => v.formats.some((f) => f.storyboard))) return "review";
  if (written.length || hasSession) return "writing";
  return "new";
}

/**
 * The later of project.json's time, the newest file the project screen shows
 * and the last change of an image a script shows (screens reload what changed
 * by this time).
 */
function latest(dir: string, updatedAt: string, videos: VideoState[], inputs: (number | undefined)[]): string {
  let t = Date.parse(updatedAt) || 0;
  for (const v of videos) {
    for (const p of [join(dir, v.script), join(dir, v.youtube), ...v.formats.flatMap((f) => [f.video, f.storyboard, f.chapters])]) {
      if (p) t = Math.max(t, mtime(p) ?? 0);
    }
  }
  // a missing image has no time
  for (const at of inputs) if (at !== undefined && Number.isFinite(at)) t = Math.max(t, at);
  return new Date(t).toISOString();
}

/** Modification time in ms, undefined when the file is not there. */
function mtime(path: string): number | undefined {
  return statSync(path, { throwIfNoEntry: false })?.mtimeMs;
}

/** Creates the folder; false when it already exists. */
async function claim(dir: string): Promise<boolean> {
  try {
    await mkdir(dir);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

/** Writes a new file and renames it over the old one: the file on disk is always whole, and a link the agent left there is replaced, not followed. */
async function writeJson(dir: string, name: string, value: unknown): Promise<void> {
  await writeFileInside(dir, join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

/** A file name not yet used in `dir`: "notes.md", "notes-2.md"… */
export function freeName(dir: string, name: string): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  let candidate = name;
  for (let n = 2; existsSync(join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`;
  return candidate;
}
