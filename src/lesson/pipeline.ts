/**
 * Lesson pipeline (script v2):
 *   validate → voice (cached per sentence, word timings) → per format:
 *   timeline → audio mix (voice + ducked music + SFX, -14 LUFS) → compose
 *   → storyboard → HyperFrames render → subtitles / chapters / script exports
 */
import { readFile, writeFile, mkdir, copyFile, cp, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pLimit from "p-limit";
import { loadConfig, type Config } from "../config.js";
import { renderWithHyperframes } from "../render/hyperframes-runner.js";
import { assertRealInside } from "../utils/inside.js";
import { removeReplaced, replacePath } from "../utils/replace.js";
import { LessonScriptSchema, type FormatName, type LessonScript } from "./schema.js";
import { loadBrand } from "./brand.js";
import { loadStyle } from "./styles.js";
import { isBundledLexicon } from "../tts/lexicon.js";
import { resolveVoiceProfile, synthesizeSegment } from "./voice.js";
import {
  buildEntries, prepareVoice, buildTimeline, buildSfxEvents, buildCaptionGroups, unknownBeatCues,
  type PreparedVoice, type SegmentAudio, type LessonTimeline,
} from "./plan.js";
import { scanSounds, resolveSound, resolveFirst, sfxDir, musicDir, ASSETS_DIR } from "./sound-library.js";
import { makeStarterSounds } from "./starter-sounds.js";
import { renderVoiceTrack, mixLessonAudio, sfxGain, musicGain, type PlacedClip } from "./audio-mix.js";
import { composeLesson, DIMS, VENDOR_SCRIPTS, THREE_VENDOR } from "./compose.js";
import { usesThree } from "./families.js";
import { captureStoryboard, capturePreview } from "./storyboard.js";
import { estimateWordTimings } from "./timing.js";
import { toSrt, toVtt, toChapters, toScriptText } from "./exports.js";
import { createReporter, type LessonEvent } from "./events.js";
import { madeFrom, seenImage, writeMadeFrom } from "./inputs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(__dirname, "runtime");
const require = createRequire(import.meta.url);
const GSAP_DIST = join(dirname(require.resolve("gsap/package.json")), "dist");
/** the "require" entry of the three package is build/three.cjs */
const THREE_CJS = require.resolve("three");
const TEMPLATE_RUNTIME_DIR = join(RUNTIME_DIR, "templates");

/** Template runtime modules (register themselves) followed by the core runtime. */
export async function loadRuntimeJs(): Promise<string> {
  const files = (await readdir(TEMPLATE_RUNTIME_DIR)).filter((f) => f.endsWith(".js")).sort();
  const parts = await Promise.all(files.map((f) => readFile(join(TEMPLATE_RUNTIME_DIR, f), "utf8")));
  return [...parts, await readFile(join(RUNTIME_DIR, "lesson-runtime.js"), "utf8")].join("\n");
}

/** core.css, then the template family styles, then the style pack. */
export async function loadLessonCss(styleCss: string): Promise<string> {
  const files = (await readdir(TEMPLATE_RUNTIME_DIR)).filter((f) => f.endsWith(".css")).sort();
  const parts = await Promise.all(files.map(async (f) => `/* ── templates/${f} ── */\n${await readFile(join(TEMPLATE_RUNTIME_DIR, f), "utf8")}`));
  const core = await readFile(join(RUNTIME_DIR, "core.css"), "utf8");
  return `${core}\n\n${parts.join("\n\n")}\n\n/* ── style pack ── */\n${styleCss}`;
}

export interface LessonRunOptions {
  formats?: FormatName[];
  style?: string;
  /** compose + storyboard only (seconds instead of minutes) */
  storyboardOnly?: boolean;
  /** skip the storyboard capture: for every format, or for the formats listed (their reviewed storyboard stays) */
  noStoryboard?: boolean | FormatName[];
  quality?: "draft" | "standard" | "high";
  fps?: number;
  crf?: number;
  /** render a quick preview.mp4 of this time range (seconds) instead of the full video */
  preview?: { from: number; to: number };
  /**
   * layout check without TTS or audio: word timings are estimated from the
   * text and only the storyboard is written (seconds, no API keys)
   */
  frames?: boolean;
  /**
   * full render without narration: estimated timings, SFX and music only
   * (motion preview when no TTS service is reachable)
   */
  silent?: boolean;
  /** steps, progress, coded warnings and output files as events (Studio tools, desktop app); the console log is unchanged */
  onEvent?: (e: LessonEvent) => void;
  /** aborting stops TTS, FFmpeg, the storyboard and the render right away (a TTS request already sent finishes in the background) */
  signal?: AbortSignal;
  /** use this config instead of reading the environment / .env.local */
  config?: Config;
  /**
   * The script comes from an agent (Studio tools, the desktop app): its images
   * must be files inside this folder, the project, and nothing is fetched from
   * the network; a lexicon is one of the bundled ones, named by id.
   */
  assetRoot?: string;
}

export interface LessonRunResult {
  outputs: { format: FormatName; dir: string; video?: string; storyboard?: string; duration: number }[];
}

export async function loadLessonScript(path: string): Promise<LessonScript> {
  return (await readLessonScript(path)).script;
}

/** The script and its text as read. */
async function readLessonScript(path: string): Promise<{ script: LessonScript; text: string }> {
  const text = await readFile(path, "utf8");
  const parsed = LessonScriptSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`script.json is invalid:\n${lines.join("\n")}`);
  }
  return { script: parsed.data, text };
}

export async function runLessonPipeline(scriptPath: string, opts: LessonRunOptions = {}): Promise<LessonRunResult> {
  const report = createReporter(opts.onEvent);
  const { signal } = opts;
  signal?.throwIfAborted();
  const cfg = opts.config ?? loadConfig();
  // the script as read now: another program may change it while the run goes on, and the outputs record which text they show
  const { script, text } = await readLessonScript(scriptPath);
  const baseDir = dirname(resolve(scriptPath));
  const lexicon = script.voice?.lexicon;
  if (opts.assetRoot && typeof lexicon === "string" && !isBundledLexicon(lexicon)) {
    throw new Error(`voice.lexicon "${lexicon}": name a bundled lexicon (e.g. "tech-vi"), not a file`);
  }
  // an agent's script: each folder the run writes in must still lead inside the project right before it writes
  // there, since another process of the agent's could switch one for a symbolic link out of it during the run
  const inside = (...dirs: string[]) => {
    if (opts.assetRoot) for (const d of dirs) assertRealInside(opts.assetRoot, d);
  };
  const brand = loadBrand(script.brand);
  const style = loadStyle(opts.style ?? script.style ?? brand.defaultStyle);
  const formats = opts.formats ?? script.formats;
  report.plan(formats);
  const vp = resolveVoiceProfile(script, cfg);
  report.info(`Lesson "${script.lesson.title}" · style ${style.id} · voice ${vp.profile}/${vp.provider} (${vp.voiceId})${vp.lexiconId ? ` · lexicon ${vp.lexiconId}` : ""}`);

  // ── 1) narration: synthesize every distinct entry once, shared by all formats
  const entriesByFormat = new Map(formats.map((f) => [f, buildEntries(script, f)] as const));
  const voice = new Map<string, { prepared: PreparedVoice; audio: SegmentAudio[] } | null>();
  const limit = pLimit(Math.max(1, cfg.ttsConcurrency));
  const jobs: Promise<void>[] = [];
  const voiceDir = join(baseDir, "voice");
  let synthCount = 0;
  const timingKinds = new Set<string>();
  for (const entries of entriesByFormat.values()) {
    for (const e of entries) {
      if (voice.has(e.key)) continue;
      const prepared = prepareVoice(e.voice, vp.lexicon);
      if (!prepared) {
        voice.set(e.key, null);
        continue;
      }
      const slot = { prepared, audio: [] as SegmentAudio[] };
      voice.set(e.key, slot);
      if (opts.frames || opts.silent) {
        slot.audio = estimatedAudio(prepared);
        continue;
      }
      prepared.segments.forEach((seg, i) => {
        if (!seg.spoken.trim()) {
          slot.audio[i] = { path: null, duration: 0, words: [] };
          return;
        }
        jobs.push(
          limit(async () => {
            signal?.throwIfAborted();
            inside(voiceDir);
            const r = await synthesizeSegment(seg.spoken, voiceDir, vp, cfg, signal);
            slot.audio[i] = { path: r.path, duration: r.duration, words: r.words };
            timingKinds.add(r.timing);
            synthCount++;
            report.progress("narration", Math.round((synthCount / jobs.length) * 100), { detail: `${synthCount}/${jobs.length}` });
          }),
        );
      });
    }
  }
  if (opts.silent) report.warn("no-narration", "  --silent: no narration, word timings are estimated");
  report.step(1, 4, `Narration: ${jobs.length} segments (TTS ${vp.provider}, cached in voice/)`);
  await Promise.all(jobs);
  signal?.throwIfAborted();
  report.info(`  word timings: ${[...timingKinds].join(", ") || "n/a"} (${synthCount} segments ready)`);

  let sfxItems = opts.frames ? [] : scanSounds(sfxDir());
  let musicItems = opts.frames ? [] : scanSounds(musicDir());
  if (!opts.frames && sfxItems.length === 0 && musicItems.length === 0) {
    report.warn("sound-library-empty", "  sound library is empty — generating placeholder sounds in _starter/ (add your own: assets/sfx/README.md)");
    try {
      await makeStarterSounds();
      sfxItems = scanSounds(sfxDir());
      musicItems = scanSounds(musicDir());
    } catch (e) {
      report.warn("starter-sounds-failed", `  starter sounds failed: ${(e as Error).message}`);
    }
  } else if (!opts.frames && sfxItems.length === 0) report.warn("sfx-library-empty", "  assets/sfx is empty — video will have no sound effects (see assets/sfx/README.md)");

  const result: LessonRunResult = { outputs: [] };
  let step = 2;
  for (const format of formats) {
    signal?.throwIfAborted();
    const outDir = join(baseDir, format);
    // a full render builds in a hidden folder beside the format's and moves everything in once its video is done:
    // a failed or cancelled render leaves the last good video with the audio, captions and chapters made with it
    const staged = !opts.preview && !opts.storyboardOnly && !opts.frames;
    const workDir = staged ? join(baseDir, `.rendering-${format}`) : outDir;
    // what this format's storyboard and video show: the script's text, and each image as its composition reads it
    const made = madeFrom(text);
    // the staged folder needs no check: it is removed first, a link there too (without following it)
    inside(outDir);
    if (staged) await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    try {
      const entries = entriesByFormat.get(format)!;
      const timeline = buildTimeline(entries, voice, style, format);
      for (const s of timeline.scenes) {
        if (!s.spec) continue;
        const bad = unknownBeatCues(s.spec, s.cues);
        if (bad.length) report.warn("unknown-cue", `  scene ${s.key}: beats reference unknown cue(s): ${bad.join(", ")} — add {${bad[0]}} to the narration`, { format, scene: s.key });
        if (s.type.startsWith("energy.punch") && s.end - s.enterAt > 1.8) report.warn("punch-too-long", `  scene ${s.key}: ${s.type} runs ${(s.end - s.enterAt).toFixed(1)}s; keep punch narration to 1–3 words (≤ 1.5 s)`, { format, scene: s.key });
      }
      report.step(step++, 4, `[${format}] ${timeline.scenes.length} scenes · ${timeline.duration.toFixed(1)}s`, format);

      // ── audio (skipped for --frames)
      const audioFile = "audio.mp3";
      if (!opts.frames) {
        const voiceClips: PlacedClip[] = timeline.scenes.flatMap((s) =>
          s.segments.filter((g) => g.path).map((g) => ({ path: g.path!, start: g.start })),
        );
        const voiceWav = join(workDir, "voice.wav");
        inside(workDir);
        await renderVoiceTrack(voiceClips, timeline.duration, voiceWav, signal);

        const sfx: PlacedClip[] = [];
        const missing = new Set<string>();
        for (const ev of buildSfxEvents(timeline, style)) {
          const item = ev.name ? resolveSound(ev.name, sfxItems, ev.seed) : resolveFirst(style.sfx[ev.event] ?? [], sfxItems, ev.seed);
          if (!item) {
            missing.add(ev.name ?? ev.event);
            continue;
          }
          const vol = ev.volume ?? style.sfxVolume[ev.event] ?? 0.3;
          sfx.push({ path: item.file, start: Math.max(0, ev.t), volume: vol * (await sfxGain(item.file)) });
        }
        signal?.throwIfAborted();
        if (sfxItems.length && missing.size) report.warn("no-sfx-match", `  no SFX matched: ${[...missing].join(", ")}`, { format });

        let music = null as null | { path: string; volume: number; duck: boolean };
        if (script.music !== "none") {
          const req = script.music;
          const item = req ? resolveSound(req.track, musicItems, script.lesson.title) : resolveFirst(style.music, musicItems, script.lesson.title);
          if (item) {
            const vol = (req && req.volume) ?? style.musicVolume;
            music = { path: item.file, volume: vol * (await musicGain(item.file)), duck: (req && req.duck) ?? true };
            report.info(`  music: ${item.name}`);
          }
          else if (req) report.warn("music-not-found", `  music "${req.track}" not found in assets/music`, { format });
        }
        signal?.throwIfAborted();
        inside(workDir);
        const mix = await mixLessonAudio({ voiceWav, totalDur: timeline.duration, music, sfx, outPath: join(workDir, audioFile), signal });
        report.info(`  audio: ${voiceClips.length} voice clips · ${sfx.length} sfx · music ${music ? "on" : "off"} · loudness ${mix.lufsIn?.toFixed(1) ?? "?"} → -14 LUFS`);
      }

      // ── composition
      signal?.throwIfAborted();
      const burn = script.captions.burn === "auto" ? format === "portrait" : script.captions.burn;
      const captions = burn ? buildCaptionGroups(timeline, format === "portrait" ? 4 : 7) : null;
      const runtimeJs = await loadRuntimeJs();
      inside(workDir);
      const { html, plan } = await composeLesson({
        script, format, timeline, style, brand, captions, scriptDir: baseDir, outDir: workDir, audioFile, runtimeJs,
        assetRoot: opts.assetRoot,
        onImage: (image, changedAt, fileId) => seenImage(made, scriptPath, image, changedAt, fileId),
      });
      inside(workDir, ...["vendor", "fonts", "brand"].map((d) => join(workDir, d)));
      await writeComposition(workDir, html, plan, style.css, brand.dir, script.lesson.title, usesThree(timeline));
      await writeFile(join(workDir, "captions.srt"), toSrt(timeline));
      await writeFile(join(workDir, "captions.vtt"), toVtt(timeline));
      await writeFile(join(workDir, "chapters.txt"), toChapters(timeline));
      await writeFile(join(workDir, "script.txt"), toScriptText(timeline));

      const out: LessonRunResult["outputs"][number] = { format, dir: outDir, duration: timeline.duration };
      if (!keepsStoryboard(opts.noStoryboard, format)) {
        const sb = join(workDir, "storyboard.jpg");
        inside(workDir);
        await captureStoryboard(workDir, heroShots(timeline), { w: DIMS[format].w, h: DIMS[format].h }, sb, {
          signal,
          onWebglUnavailable: (message) => report.warn("webgl-unavailable", message, { format }),
        });
        writeMadeFrom(sb, made, opts.assetRoot);
        out.storyboard = join(outDir, "storyboard.jpg");
        report.info(`  storyboard: ${sb}`);
      }
      if (opts.preview) {
        const pv = join(outDir, "preview.mp4");
        const to = Math.min(opts.preview.to, timeline.duration);
        inside(outDir);
        await capturePreview(outDir, { from: opts.preview.from, to }, { w: DIMS[format].w, h: DIMS[format].h }, pv, { signal });
        report.info(`  preview: ${pv} (${opts.preview.from}s → ${to.toFixed(1)}s)`);
        report.output("preview", format, pv);
      } else if (staged) {
        inside(workDir);
        await renderWithHyperframes({
          compositionDir: workDir,
          outputPath: join(workDir, "video.mp4"),
          fps: opts.fps ?? 30,
          quality: opts.quality ?? "standard",
          crf: opts.crf ?? 20,
          signal,
          onProgress: (percent, stage) => report.progress("render", percent, { format, detail: stage }),
        });
        // what the video shows: published with it
        writeMadeFrom(join(workDir, "video.mp4"), made, opts.assetRoot);
        inside(workDir, outDir);
        await publishRender(workDir, outDir);
        out.video = join(outDir, "video.mp4");
      }
      // the files, where they stay
      report.output("captions", format, join(outDir, "captions.srt"));
      report.output("chapters", format, join(outDir, "chapters.txt"));
      report.output("script", format, join(outDir, "script.txt"));
      if (out.storyboard) report.output("storyboard", format, out.storyboard);
      if (out.video) report.output("video", format, out.video);
      result.outputs.push(out);
    } catch (e) {
      if (staged) await rm(workDir, { recursive: true, force: true });
      throw e;
    }
  }
  return result;
}

/**
 * Moves a finished render from the folder it was built in into the format's
 * folder. The video goes first: it is the file another program may hold open,
 * so a refusal leaves the last good set as it was.
 */
async function publishRender(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  await removeReplaced(to);
  const names = (await readdir(from)).sort((a, b) => Number(b === "video.mp4") - Number(a === "video.mp4"));
  for (const name of names) await replacePath(join(from, name), join(to, name));
  await rm(from, { recursive: true, force: true });
}

/** The run leaves the format's storyboard as it is (noStoryboard: all formats, or the ones listed). */
export function keepsStoryboard(noStoryboard: LessonRunOptions["noStoryboard"], format: FormatName): boolean {
  return noStoryboard === true || (Array.isArray(noStoryboard) && noStoryboard.includes(format));
}

/** Estimated narration timing (~0.28 s per word) for --frames. */
function estimatedAudio(prepared: PreparedVoice): SegmentAudio[] {
  return prepared.segments.map((seg) => {
    const duration = seg.spoken.trim() ? 0.3 + seg.spoken.trim().split(/\s+/).length * 0.28 : 0;
    return { path: null, duration, words: estimateWordTimings(seg.spoken, duration) };
  });
}

/** One frame per scene where everything has arrived (just before the next transition). */
function heroShots(timeline: LessonTimeline) {
  return timeline.scenes.map((s) => {
    const spoken = s.voiceEnd - s.voiceStart > 0.3;
    const t = spoken ? Math.max(s.enterAt + 0.2, Math.min(s.end - 0.15, s.voiceEnd - 0.05)) : s.end - 0.3;
    return { t, label: `${s.key} · ${s.type} · ${t.toFixed(1)}s` };
  });
}

export async function writeComposition(outDir: string, html: string, plan: unknown, styleCss: string, brandDir: string, title: string, three = false) {
  await writeFile(join(outDir, "index.html"), html);
  await writeFile(join(outDir, "plan.json"), JSON.stringify(plan, null, 1));
  await writeFile(join(outDir, "lesson.css"), await loadLessonCss(styleCss));
  await mkdir(join(outDir, "vendor"), { recursive: true });
  for (const f of VENDOR_SCRIPTS) await copyFile(join(GSAP_DIST, f), join(outDir, "vendor", f));
  // three.js ships ES modules plus a require-free CommonJS build; wrapping the
  // latter gives a classic script, so 3D scenes are ready before HyperFrames seeks.
  if (three) await writeFile(join(outDir, "vendor", THREE_VENDOR), `(function(){var exports={};\n${await readFile(THREE_CJS, "utf8")}\nwindow.THREE=exports;})();\n`);
  await cp(join(ASSETS_DIR, "fonts"), join(outDir, "fonts"), { recursive: true });
  await cp(brandDir, join(outDir, "brand"), { recursive: true });
  await writeFile(
    join(outDir, "hyperframes.json"),
    JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }, null, 2),
  );
  await writeFile(join(outDir, "meta.json"), JSON.stringify({ id: `lesson-${Date.now()}`, name: title, createdAt: new Date().toISOString() }, null, 2));
}
