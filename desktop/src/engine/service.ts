/**
 * What the engine host does, apart from the utility-process plumbing: loads
 * the built engine from its folder, runs the Studio tools server, renders one
 * job at a time and reports progress as events.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
// the engine as built: the host loads dist/studio/engine.js at run time
import type * as Engine from "../../../dist/studio/engine.js";
import type { FormatName, StoryboardReview } from "../shared/types";
import type { HostEvent, HostMethod, HostParams, HostResult } from "./protocol";

type EngineModule = typeof Engine;

export interface HostService {
  handle<M extends HostMethod>(method: M, params: HostParams<M>): Promise<HostResult<M>>;
  close(): Promise<void>;
}

export function createHostService(emit: (event: HostEvent) => void, load = loadEngine): HostService {
  let engine: EngineModule | undefined;
  let studio: Engine.StudioHttp | undefined;
  let renders: Engine.JobRunner | undefined;
  const jobs = new Map<string, Engine.Job>();

  const ready = () => {
    if (!engine || !studio || !renders) throw new Error("The engine is not loaded yet");
    return { engine, studio, renders };
  };

  const methods: { [M in HostMethod]: (p: HostParams<M>) => Promise<HostResult<M>> | HostResult<M> } = {
    async init({ engineRoot }) {
      if (!engine) {
        engine = await load(engineRoot);
        // a render and an agent's storyboard never run at the same time
        const gate = new engine.Gate();
        renders = new engine.JobRunner({ gate });
        studio = await engine.startStudioHttp({ gate });
      }
      const { version } = JSON.parse(readFileSync(join(engineRoot, "package.json"), "utf8")) as { version: string };
      return { studioUrl: ready().studio.url, engineVersion: version, chromeBuild: engine.hyperframesChromeBuild() };
    },

    setEnv({ env }) {
      for (const [key, value] of Object.entries(env)) {
        if (value === null) delete process.env[key];
        else process.env[key] = value;
      }
    },

    openProject({ dir }) {
      return { token: ready().studio.addProject(dir).token };
    },

    closeProject({ token }) {
      ready().studio.removeProject(token);
    },

    checkScript({ dir, script }) {
      const { engine } = ready();
      const check = engine.validateScript(new engine.Project(dir), script);
      // the formats are known once the script parses, even if its brand or style is wrong
      const formats: FormatName[] = check.summary?.formats ?? [];
      return { ok: check.ok, errors: check.errors, formats };
    },

    async review({ dir, script, format }) {
      const { engine } = ready();
      const review: StoryboardReview = await engine.storyboardReview(new engine.Project(dir).path(script), format);
      return review;
    },

    catalog() {
      const { engine } = ready();
      return engine.catalog(engine.loadConfig());
    },

    async checkFfmpeg() {
      const { engine } = ready();
      const [ffmpeg, ffprobe] = await Promise.all([engine.toolVersion(engine.ffmpegBin()), engine.toolVersion(engine.ffprobeBin())]);
      return { ffmpeg, ffprobe };
    },

    async chrome({ cacheDir, install }) {
      const { engine } = ready();
      const path = install
        ? await engine.installChrome(cacheDir, (percent) => emit({ type: "chrome", percent }))
        : await engine.installedChrome(cacheDir);
      return { path, build: engine.hyperframesChromeBuild() };
    },

    render({ dir, script, quality }) {
      const { engine, renders } = ready();
      const scriptPath = new engine.Project(dir).path(script);
      let jobId = "";
      const report = (e: Engine.LessonEvent) => {
        if (e.type === "plan") emit({ type: "render", jobId, status: "running", formats: e.formats });
        else if (e.type === "progress") {
          const stage = e.stage === "render" ? (e.detail ?? "Rendering") : "Narration";
          emit({ type: "render", jobId, status: "running", format: e.format, stage, percent: e.percent });
        } else if (e.type === "step") emit({ type: "render", jobId, status: "running", stage: e.message });
      };
      const job = renders.start("render", async ({ signal, onEvent }) => {
        emit({ type: "render", jobId, status: "running", percent: 0 });
        // no formats given: the pipeline renders the ones the script asks for now, which the agent may have changed while the job waited
        return engine.runLessonPipeline(scriptPath, {
          quality,
          // each reviewed storyboard stays; a missing one or one older than the script is captured again with the video
          noStoryboard: FORMATS.filter((f) => storyboardCurrent(scriptPath, f)),
          signal,
          onEvent: (e) => {
            onEvent(e);
            report(e);
          },
        });
      });
      jobId = job.id;
      jobs.set(job.id, job);
      emit({ type: "render", jobId, status: "queued", percent: 0 });
      void job.done.then(() => {
        jobs.delete(job.id);
        const result = job.result as Engine.LessonRunResult | undefined;
        emit({
          type: "render",
          jobId,
          status: job.status,
          percent: job.status === "done" ? 100 : undefined,
          error: job.error,
          outputs: result?.outputs.flatMap((o) => (o.video ? [{ format: o.format, video: o.video }] : [])),
        });
      });
      return { jobId };
    },

    cancel({ jobId }) {
      jobs.get(jobId)?.cancel();
    },
  };

  return {
    async handle(method, params) {
      const fn = methods[method] as (p: typeof params) => Promise<HostResult<typeof method>> | HostResult<typeof method>;
      if (!fn) throw new Error(`Unknown engine host method: ${String(method)}`);
      return fn(params);
    },
    async close() {
      renders?.cancelAll();
      await studio?.close();
    },
  };
}

/** The built engine: dist/studio/engine.js in the engine folder. */
export async function loadEngine(engineRoot: string): Promise<EngineModule> {
  return (await import(/* @vite-ignore */ pathToFileURL(join(engineRoot, "dist", "studio", "engine.js")).href)) as EngineModule;
}

const FORMATS: FormatName[] = ["landscape", "portrait"];

/** The format's storyboard.jpg exists and is not older than the script (what the storyboard review calls not stale). */
export function storyboardCurrent(scriptPath: string, format: FormatName): boolean {
  const script = statSync(scriptPath, { throwIfNoEntry: false });
  const storyboard = statSync(join(dirname(scriptPath), format, "storyboard.jpg"), { throwIfNoEntry: false });
  return !!script && !!storyboard && storyboard.mtimeMs >= script.mtimeMs;
}
