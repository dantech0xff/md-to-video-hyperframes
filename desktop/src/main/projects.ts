/**
 * Project folders (design doc §7): one folder per video project under the
 * projects folder, holding project.json, the material in sources/, what the
 * agent writes and what the engine renders. The app also keeps its own state
 * for the project (the activity log) in .getframes/.
 */
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
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
    return JSON.parse(await readFile(join(this.dir(id), PROJECT_FILE), "utf8")) as ProjectFile;
  }

  async update(id: string, change: (p: ProjectFile) => void): Promise<ProjectFile> {
    const project = await this.read(id);
    change(project);
    project.updatedAt = this.now().toISOString();
    await writeJson(join(this.dir(id), PROJECT_FILE), project);
    return project;
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
    // a news brief tells only what the material says
    if (req.kind === "news" && !req.files.length && !req.urls.some((u) => u.trim()) && !req.text.trim()) {
      throw new Error("Bản tin cần ít nhất một nguồn: link bài báo, file hoặc nội dung dán vào.");
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
      await writeJson(join(dir, PROJECT_FILE), project);
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
    await writeFile(join(dir, "AGENTS.md"), agentsMd(project, videoTargets(project.kind)));
    await writeFile(join(dir, "CLAUDE.md"), CLAUDE_MD);
    for (const target of [join(dir, ".agents", "skills"), join(dir, ".claude", "skills")]) {
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
    const facts = scriptFacts(script);
    const exists = facts.inputsAt !== undefined;
    const shown = formats?.length ? formats : facts.formats;
    const video: VideoState = {
      ...t,
      exists,
      valid: exists,
      errors: [],
      youtubeExists: existsSync(join(dir, t.youtube)),
      formats: (shown?.length ? shown : defaultFormats(kind, t)).map((format) => formatFiles(join(dirname(script), format), format, facts.inputsAt)),
    };
    return { video, inputsAt: facts.inputsAt };
  }
}

function formatFiles(out: string, format: FormatName, inputsAt: number | undefined): FormatState {
  const file = (name: string) => (existsSync(join(out, name)) ? join(out, name) : undefined);
  let duration: number | undefined;
  try {
    duration = (JSON.parse(readFileSync(join(out, "plan.json"), "utf8")) as { duration?: number }).duration;
  } catch {
    // no storyboard yet
  }
  const video = file("video.mp4");
  // the script, or an image it shows, changed after the render: the video may not show the change
  const videoStale = !!video && inputsAt !== undefined && (mtime(video) ?? 0) < inputsAt;
  return { format, storyboard: file("storyboard.jpg"), video, videoStale, duration, captions: file("captions.srt"), chapters: file("chapters.txt") };
}

/** Scene fields that name an image file: the ones the engine counts too (src/lesson/inputs.ts). */
export const IMAGE_FIELDS = ["image", "media", "avatar", "src"];

/**
 * What the screens need from a script without validating it (the project list
 * must stay fast): its formats, and when it or a local image its scenes show
 * last changed, counted as the engine counts it (an image from its change or
 * replacement time). `inputsAt` is Infinity when such an image is missing,
 * undefined when there is no script.
 */
function scriptFacts(scriptPath: string): { formats?: FormatName[]; inputsAt?: number } {
  const script = statSync(scriptPath, { throwIfNoEntry: false });
  if (!script) return {};
  let raw: { formats?: unknown; chapters?: unknown };
  try {
    raw = JSON.parse(readFileSync(scriptPath, "utf8")) as typeof raw;
  } catch {
    return { inputsAt: script.mtimeMs };
  }
  const formats = Array.isArray(raw?.formats) ? raw.formats.filter((f): f is FormatName => f === "landscape" || f === "portrait") : undefined;
  let inputsAt = script.mtimeMs;
  const scenes = (Array.isArray(raw?.chapters) ? raw.chapters : []).flatMap((c: { scenes?: unknown }) => (Array.isArray(c?.scenes) ? c.scenes : []));
  for (const scene of scenes as Record<string, unknown>[]) {
    for (const field of IMAGE_FIELDS) {
      const value = scene?.[field];
      // a URL scheme ("https:"), not a Windows drive ("C:\")
      if (typeof value !== "string" || !value || (/^[a-z][a-z\d+.-]*:/i.test(value) && !isAbsolute(value))) continue;
      const image = statSync(resolve(dirname(scriptPath), value), { throwIfNoEntry: false });
      if (!image) return { formats, inputsAt: Infinity };
      inputsAt = Math.max(inputsAt, image.mtimeMs, image.ctimeMs);
    }
  }
  return { formats, inputsAt };
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** A file name not yet used in `dir`: "notes.md", "notes-2.md"… */
export function freeName(dir: string, name: string): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  let candidate = name;
  for (let n = 2; existsSync(join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`;
  return candidate;
}
