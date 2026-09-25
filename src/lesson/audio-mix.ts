/**
 * Lesson audio mix (ffmpeg):
 *   voice segments placed at absolute times
 * + background music (looped, faded, ducked under the voice)
 * + SFX at timeline events
 * → loudness-normalized to -14 LUFS (YouTube / TikTok target), true peak -1.5 dBTP.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg failed (exit ${code}): ${err.slice(-2000)}`))));
    proc.on("error", reject);
  });
}

export interface PlacedClip {
  path: string;
  /** absolute start time (seconds) */
  start: number;
  volume?: number;
}

export interface MusicSpec {
  path: string;
  /** base gain before ducking (0–1), default 0.16 */
  volume?: number;
  duck?: boolean;
  fadeIn?: number;
  fadeOut?: number;
}

const FMT = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";
const ms = (s: number) => Math.max(0, Math.round(s * 1000));

/** ffmpeg's filter parser needs ':' ',' etc. escaped inside option values — we only pass numbers. */
const n = (x: number) => Number(x.toFixed(4));

/**
 * Place voice segments on a silent bed of `totalDur` seconds → WAV.
 * Segments are mixed in batches to keep ffmpeg's input count reasonable.
 */
export async function renderVoiceTrack(clips: PlacedClip[], totalDur: number, outWav: string): Promise<void> {
  const BATCH = 48;
  if (clips.length <= BATCH) {
    await mixPlaced(clips, totalDur, outWav);
    return;
  }
  const tmp = await mkdtemp(join(tmpdir(), "voice-"));
  try {
    const parts: PlacedClip[] = [];
    for (let i = 0; i < clips.length; i += BATCH) {
      const part = join(tmp, `part-${i}.wav`);
      await mixPlaced(clips.slice(i, i + BATCH), totalDur, part);
      parts.push({ path: part, start: 0 });
    }
    await mixPlaced(parts, totalDur, outWav);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function mixPlaced(clips: PlacedClip[], totalDur: number, outWav: string): Promise<void> {
  const args = ["-y", "-f", "lavfi", "-t", String(n(totalDur)), "-i", "anullsrc=r=44100:cl=stereo"];
  const filters: string[] = [];
  const labels = ["[0:a]"];
  clips.forEach((c, i) => {
    args.push("-i", c.path);
    const d = ms(c.start);
    filters.push(`[${i + 1}:a]${FMT},volume=${n(c.volume ?? 1)},adelay=${d}|${d}[c${i}]`);
    labels.push(`[c${i}]`);
  });
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=first:dropout_transition=0[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", "-ar", "44100", outWav);
  await run(args);
}

export interface MixArgs {
  voiceWav: string;
  totalDur: number;
  music?: MusicSpec | null;
  sfx: PlacedClip[];
  outPath: string;
  /** integrated loudness target, default -14 LUFS */
  lufs?: number;
}

export async function mixLessonAudio(a: MixArgs): Promise<{ lufsIn: number | null }> {
  const tmp = await mkdtemp(join(tmpdir(), "mix-"));
  try {
    // 1) SFX bed (batched like the voice)
    let sfxWav: string | null = null;
    if (a.sfx.length > 0) {
      sfxWav = join(tmp, "sfx.wav");
      await renderVoiceTrack(a.sfx, a.totalDur, sfxWav);
    }

    // 2) voice + ducked music + sfx
    const pre = join(tmp, "premix.wav");
    const args = ["-y", "-i", a.voiceWav];
    const f: string[] = [`[0:a]${FMT},apad=whole_dur=${n(a.totalDur)},atrim=0:${n(a.totalDur)}[v]`];
    const mixIns: string[] = [];
    let idx = 1;
    if (a.music) {
      args.push("-stream_loop", "-1", "-i", a.music.path);
      const vol = a.music.volume ?? 0.16;
      const fi = a.music.fadeIn ?? 1.5;
      const fo = Math.min(a.music.fadeOut ?? 3, a.totalDur / 3);
      f.push(
        `[${idx}:a]${FMT},atrim=0:${n(a.totalDur)},asetpts=N/SR/TB,volume=${n(vol)},` +
          `afade=t=in:st=0:d=${n(fi)},afade=t=out:st=${n(Math.max(a.totalDur - fo, 0))}:d=${n(fo)}[m0]`,
      );
      if (a.music.duck !== false) {
        f.push(`[v]asplit=2[vmix][vkey]`);
        f.push(`[m0][vkey]sidechaincompress=threshold=0.025:ratio=8:attack=25:release=450:makeup=1[m]`);
        mixIns.push("[vmix]", "[m]");
      } else {
        mixIns.push("[v]", "[m0]");
      }
      idx++;
    } else {
      mixIns.push("[v]");
    }
    if (sfxWav) {
      args.push("-i", sfxWav);
      f.push(`[${idx}:a]${FMT}[s]`);
      mixIns.push("[s]");
      idx++;
    }
    f.push(`${mixIns.join("")}amix=inputs=${mixIns.length}:normalize=0:duration=first:dropout_transition=0[mix]`);
    args.push("-filter_complex", f.join(";"), "-map", "[mix]", "-c:a", "pcm_s16le", "-ar", "44100", pre);
    await run(args);

    // 3) two-pass loudness normalization
    const target = a.lufs ?? -14;
    const measure = await run([
      "-hide_banner", "-i", pre,
      "-af", `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`,
      "-f", "null", "-",
    ]);
    const json = measure.slice(measure.lastIndexOf("{"), measure.lastIndexOf("}") + 1);
    let lufsIn: number | null = null;
    let second = `loudnorm=I=${target}:TP=-1.5:LRA=11`;
    try {
      const m = JSON.parse(json) as Record<string, string>;
      lufsIn = Number(m.input_i);
      if (Number.isFinite(lufsIn) && lufsIn > -70) {
        second +=
          `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
          `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
      }
    } catch {
      /* fall back to single-pass */
    }
    await run(["-y", "-i", pre, "-af", `${second},aresample=44100`, "-c:a", "libmp3lame", "-b:a", "192k", a.outPath]);
    return { lufsIn };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Measure integrated loudness of a file (for tests / reports). */
export async function measureLufs(path: string): Promise<number> {
  const out = await run(["-hide_banner", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  const json = out.slice(out.lastIndexOf("{"), out.lastIndexOf("}") + 1);
  return Number((JSON.parse(json) as Record<string, string>).input_i);
}

const levelCache = new Map<string, Promise<number>>();
const cached = (key: string, fn: () => Promise<number>) => {
  if (!levelCache.has(key)) levelCache.set(key, fn().catch(() => 1));
  return levelCache.get(key)!;
};
const dbToGain = (db: number) => Math.pow(10, Math.max(-24, Math.min(24, db)) / 20);

/**
 * Gain that brings a sound effect's peak to -1 dBFS, so files from different
 * sources sit at the same level before the style's per-event volume applies.
 */
export function sfxGain(path: string): Promise<number> {
  return cached(`sfx|${path}`, async () => {
    const out = await run(["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"]);
    const m = /max_volume:\s*(-?[\d.]+) dB/.exec(out);
    return m ? dbToGain(-1 - Number(m[1])) : 1;
  });
}

/** Gain that brings a music track to -14 LUFS (static, dynamics untouched). */
export function musicGain(path: string): Promise<number> {
  return cached(`music|${path}`, async () => {
    const lufs = await measureLufs(path);
    return Number.isFinite(lufs) && lufs > -70 ? dbToGain(-14 - lufs) : 1;
  });
}

/** Write a short silent mp3 (used when a segment has no text). */
export async function writeSilence(path: string, seconds: number): Promise<void> {
  await run(["-y", "-f", "lavfi", "-t", String(n(seconds)), "-i", "anullsrc=r=44100:cl=mono", "-c:a", "libmp3lame", "-b:a", "64k", path]);
}

export async function writeText(path: string, text: string): Promise<void> {
  await writeFile(path, text);
}
