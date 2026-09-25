/**
 * Project folders (design doc §7): one folder per video project under the
 * projects folder, holding project.json, the material in sources/, what the
 * agent writes and what the engine renders. The app also keeps its own state
 * for the project (the activity log) in .getframes/.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
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
import { agentsMd, CLAUDE_MD } from "./prompts";

export const APP_DIR = ".getframes";
const PROJECT_FILE = "project.json";

export function videoTargets(kind: VideoKind): VideoTarget[] {
  return kind === "lesson"
    ? [
        { id: "main", label: "Bài giảng 16:9", script: "script.json", youtube: "youtube.md" },
        { id: "short", label: "Short 9:16", script: "short/script.json", youtube: "short/youtube.md" },
      ]
    : [{ id: "main", label: "Short 9:16", script: "script.json", youtube: "youtube.md" }];
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

  /** Folder of a project; the id is a folder name, never a path. */
  dir(id: string): string {
    if (!id || id === "." || id === ".." || /[\\/:*?"<>|]/.test(id)) throw new Error(`Invalid project id: ${id}`);
    const dir = join(this.root, id);
    if (!existsSync(join(dir, PROJECT_FILE))) throw new Error(`No project "${id}" in ${this.root}`);
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
        agent: { id: "claude-code" },
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
    const videos = videoTargets(project.kind).map((t) => this.videoFiles(dir, project.kind, t, readFormats(join(dir, t.script))));
    return {
      id,
      dir,
      title: project.title,
      kind: project.kind,
      stage: stageOf(videos, !!project.agent.sessionId),
      agentState,
      updatedAt: latest(dir, project.updatedAt, videos),
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
      const formats = result.formats.length ? result.formats : readFormats(join(summary.dir, t.script));
      videos.push({ ...this.videoFiles(summary.dir, project.kind, t, formats), exists, valid: result.ok, errors: result.errors });
    }
    return { ...summary, request: project.request, sources: project.sources, videos };
  }

  private videoFiles(dir: string, kind: VideoKind, t: VideoTarget, formats: FormatName[] | undefined): VideoState {
    const script = join(dir, t.script);
    const scriptTime = mtime(script);
    const exists = scriptTime !== undefined;
    return {
      ...t,
      exists,
      valid: exists,
      errors: [],
      youtubeExists: existsSync(join(dir, t.youtube)),
      formats: (formats?.length ? formats : defaultFormats(kind, t)).map((format) => formatFiles(join(dirname(script), format), format, scriptTime)),
    };
  }
}

function formatFiles(out: string, format: FormatName, scriptTime: number | undefined): FormatState {
  const file = (name: string) => (existsSync(join(out, name)) ? join(out, name) : undefined);
  let duration: number | undefined;
  try {
    duration = (JSON.parse(readFileSync(join(out, "plan.json"), "utf8")) as { duration?: number }).duration;
  } catch {
    // no storyboard yet
  }
  const video = file("video.mp4");
  // the script changed after the render: the video may not show the change
  const videoStale = !!video && scriptTime !== undefined && (mtime(video) ?? 0) < scriptTime;
  return { format, storyboard: file("storyboard.jpg"), video, videoStale, duration, captions: file("captions.srt"), chapters: file("chapters.txt") };
}

/** `formats` of a script without validating it (the list must stay fast). */
function readFormats(scriptPath: string): FormatName[] | undefined {
  try {
    const formats = (JSON.parse(readFileSync(scriptPath, "utf8")) as { formats?: unknown }).formats;
    return Array.isArray(formats) ? formats.filter((f): f is FormatName => f === "landscape" || f === "portrait") : undefined;
  } catch {
    return undefined;
  }
}

function stageOf(videos: VideoState[], hasSession: boolean): ProjectStage {
  const written = videos.filter((v) => v.exists);
  // rendered: every video of the project (a lesson's Short too), in each of its formats, and newer than its script
  if (videos.every((v) => v.exists && v.formats.every((f) => f.video && !f.videoStale))) return "rendered";
  if (written.some((v) => v.formats.some((f) => f.storyboard))) return "review";
  if (written.length || hasSession) return "writing";
  return "new";
}

/** The later of project.json's time and the newest file the project screen shows (screens reload what changed by this time). */
function latest(dir: string, updatedAt: string, videos: VideoState[]): string {
  let t = Date.parse(updatedAt) || 0;
  for (const v of videos) {
    for (const p of [join(dir, v.script), join(dir, v.youtube), ...v.formats.flatMap((f) => [f.video, f.storyboard, f.chapters])]) {
      if (p) t = Math.max(t, mtime(p) ?? 0);
    }
  }
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
