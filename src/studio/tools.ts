/**
 * The Studio tools: what an agent (Claude Code, Codex, Devin…) calls instead
 * of `npm run lesson:*` when it works inside Get Frames. They validate the
 * script, build the layout check or the real storyboard, and describe what
 * this machine has (styles, brands, voices, sounds). Rendering is not a tool:
 * the app renders after the user approves the storyboard.
 *
 * Every path an agent passes or gets back is relative to the project folder.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, type Config } from "../config.js";
import { listBrands, loadBrand } from "../lesson/brand.js";
import type { LessonEvent } from "../lesson/events.js";
import { runLessonPipeline, type LessonRunOptions, type LessonRunResult } from "../lesson/pipeline.js";
import { LessonScriptSchema, type FormatName } from "../lesson/schema.js";
import { musicDir, scanSounds, sfxDir } from "../lesson/sound-library.js";
import { listStyles, loadStyle } from "../lesson/styles.js";
import type { Job, JobRunner } from "./jobs.js";
import type { Project } from "./project.js";

export interface StudioContext {
  project: Project;
  jobs: JobRunner;
  /** engine config (the app passes keys from its keychain); defaults to the environment */
  config?: () => Config;
  /** how long a tool call waits for its job before answering "running" */
  softLimitMs?: number;
}

/** Stays under the 60 s MCP tool timeout Codex applies by default. */
export const SOFT_LIMIT_MS = 45_000;

/** Speaking rate of the free voice, as in the skill: ~150 words per minute. */
const WORDS_PER_SECOND = 2.6;

const SCRIPT = z.string().optional().describe('Script path inside the project folder (default "script.json")');
const FORMATS = z
  .array(z.enum(["landscape", "portrait"]))
  .min(1)
  .optional()
  .describe("Formats to build (default: the script's formats)");

export function registerStudioTools(server: McpServer, ctx: StudioContext): void {
  server.registerTool(
    "validate_script",
    {
      title: "Validate the lesson script",
      description:
        "Check script.json (lesson schema v2) without building anything: every schema error with its path " +
        "(e.g. chapters.0.scenes.2.voice), an unknown brand or style, and a summary with an estimated duration. " +
        "Takes milliseconds; call it after every edit.",
      inputSchema: { script: SCRIPT },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ script }) => result(validateScript(ctx.project, script)),
  );

  server.registerTool(
    "check_layout",
    {
      title: "Check the layout (no narration)",
      description:
        "Build the storyboard from estimated timings: no TTS, no audio, no API keys, about 10 seconds. " +
        "Returns per format the storyboard image, one image per scene (open them to check that text fits and nothing overlaps), " +
        "the estimated duration and coded warnings. Run it before build_storyboard.",
      inputSchema: { script: SCRIPT, formats: FORMATS },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ script, formats }) => runStoryboardJob(ctx, "check_layout", script, { frames: true, formats }),
  );

  server.registerTool(
    "build_storyboard",
    {
      title: "Build the storyboard with narration",
      description:
        "Synthesize the narration (cached per sentence), mix the audio and capture the storyboard with the real word timings. " +
        "Returns per format the duration, the storyboard image, one image per scene and chapters.txt, plus coded warnings " +
        "(unknown-cue, no-sfx-match, punch-too-long, music-not-found…) to fix in the script. " +
        'A long lesson can take minutes: if the answer has status "running", call wait_job with its jobId.',
      inputSchema: { script: SCRIPT, formats: FORMATS },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ script, formats }) => runStoryboardJob(ctx, "build_storyboard", script, { storyboardOnly: true, formats }),
  );

  server.registerTool(
    "wait_job",
    {
      title: "Wait for a Studio job",
      description:
        'Wait for a check_layout or build_storyboard job that answered status "running". Returns its result once it ' +
        'finishes, or status "running" again after about 45 seconds.',
      inputSchema: { jobId: z.string().describe("The jobId from the earlier answer") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ jobId }) => {
      const job = ctx.jobs.get(jobId);
      if (!job) return result({ status: "unknown", error: `No job ${jobId} in this project` }, true);
      await ctx.jobs.wait(job, ctx.softLimitMs ?? SOFT_LIMIT_MS);
      return jobResult(ctx.project, job);
    },
  );

  server.registerTool(
    "list_catalog",
    {
      title: "List styles, brands, voices and sounds",
      description:
        "What this machine has: style packs, brand kits, which voice profiles work (free = Edge TTS; clone needs a configured " +
        "provider), and the names of the SFX and music files in the user's library. SFX and music are picked by these names.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => result(catalog(ctx.config?.() ?? loadConfig())),
  );
}

// ── validate_script ────────────────────────────────────────────────────────

interface Problem {
  path: string;
  message: string;
}

export function validateScript(project: Project, script = "script.json") {
  let path: string;
  try {
    path = project.path(script);
  } catch (e) {
    return { ok: false, errors: [{ path: "(file)", message: (e as Error).message }] };
  }
  if (!existsSync(path)) return { ok: false, errors: [{ path: "(file)", message: `${script} does not exist in the project folder` }] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, errors: [{ path: "(json)", message: (e as Error).message }] };
  }
  const parsed = LessonScriptSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Problem[] = parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));
    return { ok: false, errors };
  }

  const s = parsed.data;
  const errors: Problem[] = [];
  try {
    loadBrand(s.brand);
  } catch (e) {
    errors.push({ path: "brand", message: (e as Error).message });
  }
  if (s.style && !listStyles().includes(s.style)) errors.push({ path: "style", message: `Unknown style "${s.style}". Available: ${listStyles().join(", ")}` });

  const scenes = s.chapters.flatMap((c) => c.scenes);
  const narration = [...s.chapters.map((c) => c.voice ?? ""), ...scenes.map((sc) => sc.voice)];
  const words = narration.reduce((n, v) => n + spokenWords(v), 0);
  const pauses = narration.reduce((n, v) => n + pauseSeconds(v), 0);
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      title: s.lesson.title,
      formats: s.formats,
      style: s.style ?? `${loadBrandSafe(s.brand)?.defaultStyle ?? "?"} (brand default)`,
      brand: s.brand,
      chapters: s.chapters.length,
      scenes: scenes.length,
      words,
      estimatedSeconds: Math.round(words / WORDS_PER_SECOND + pauses),
    },
  };
}

/** Words the narrator speaks: cue markers like {1}, {L2-3}, {show:api} are not read. */
function spokenWords(voice: string): number {
  return voice.replace(/\{[^}]*\}/g, " ").split(/\s+/).filter(Boolean).length;
}

function pauseSeconds(voice: string): number {
  return [...voice.matchAll(/\{pause:(\d+(?:\.\d+)?)\}/g)].reduce((n, m) => n + Number(m[1]), 0);
}

function loadBrandSafe(id: string) {
  try {
    return loadBrand(id);
  } catch {
    return undefined;
  }
}

// ── check_layout / build_storyboard / wait_job ────────────────────────────

async function runStoryboardJob(
  ctx: StudioContext,
  kind: "check_layout" | "build_storyboard",
  script: string | undefined,
  opts: Pick<LessonRunOptions, "frames" | "storyboardOnly"> & { formats?: FormatName[] },
): Promise<CallToolResult> {
  // a script that does not validate would only fail inside the job
  const check = validateScript(ctx.project, script);
  if (!check.ok) return result({ status: "invalid", errors: check.errors }, true);

  const path = ctx.project.path(script ?? "script.json");
  const job = ctx.jobs.start(kind, ({ signal, onEvent }) => runLessonPipeline(path, { ...opts, signal, onEvent, config: ctx.config?.() }));
  await ctx.jobs.wait(job, ctx.softLimitMs ?? SOFT_LIMIT_MS);
  return jobResult(ctx.project, job);
}

function jobResult(project: Project, job: Job): CallToolResult {
  const warnings = job.events
    .filter((e): e is Extract<LessonEvent, { type: "warning" }> => e.type === "warning")
    .map(({ code, message, format, scene }) => ({ code, message, format, scene }));
  const base = { jobId: job.id, kind: job.kind, status: job.status };

  if (job.status === "queued" || job.status === "running") {
    const step = lastEvent(job, "step");
    const progress = lastEvent(job, "progress");
    return result({
      ...base,
      step: step?.message,
      progress: progress && { stage: progress.stage, percent: progress.percent, detail: progress.detail },
      warnings,
      next: `Still working. Call wait_job with {"jobId": "${job.id}"}.`,
    });
  }
  if (job.status !== "done") return result({ ...base, error: job.error, warnings }, true);

  const run = job.result as LessonRunResult;
  return result({
    ...base,
    formats: run.outputs.map((o) => ({
      format: o.format,
      durationSeconds: Math.round(o.duration * 10) / 10,
      storyboard: o.storyboard && project.rel(o.storyboard),
      shots: o.storyboard ? shots(o.dir).map((f) => project.rel(f)) : [],
      chapters: project.rel(join(o.dir, "chapters.txt")),
    })),
    warnings,
  });
}

function lastEvent<T extends LessonEvent["type"]>(job: Job, type: T): Extract<LessonEvent, { type: T }> | undefined {
  for (let i = job.events.length - 1; i >= 0; i--) {
    const e = job.events[i];
    if (e.type === type) return e as Extract<LessonEvent, { type: T }>;
  }
  return undefined;
}

/** Full-size frames of the storyboard, one per scene, in scene order. */
function shots(formatDir: string): string[] {
  const dir = join(formatDir, "storyboard");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^shot-\d+\.png$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}

// ── list_catalog ──────────────────────────────────────────────────────────

function catalog(cfg: Config) {
  const cloneReady =
    cfg.cloneProvider === "elevenlabs" ? !!(cfg.elevenlabsApiKey && cfg.elevenlabsVoiceId) : !!(cfg.lucylabApiKey && cfg.lucylabVoiceId);
  return {
    styles: listStyles().map((id) => ({ id, name: loadStyle(id).name })),
    brands: listBrands().map((id) => ({ id, name: loadBrandSafe(id)?.name })),
    voices: {
      default: cfg.voiceProfile,
      free: { available: true, provider: "edge-tts", voice: cfg.edgeTtsVoice },
      clone: { available: cloneReady, provider: cfg.cloneProvider },
    },
    sfx: scanSounds(sfxDir()).map((s) => s.name),
    music: scanSounds(musicDir()).map((s) => s.name),
  };
}

function result(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) };
}
