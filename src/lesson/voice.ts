/**
 * Voice layer for the lesson pipeline.
 *
 * Two profiles:
 *   - "free"  → Microsoft Edge TTS (no key, word timings included)
 *   - "clone" → the instructor's cloned voice on ElevenLabs (with-timestamps)
 *               or LucyLab (SRT timings)
 *
 * Each narration segment is synthesized once and cached by content hash, so
 * editing one sentence only re-synthesizes that sentence.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.js";
import { EdgeTtsClient } from "../tts/edge-tts-client.js";
import { ElevenLabsClient } from "../tts/elevenlabs-client.js";
import { LucylabClient } from "../tts/lucylab-client.js";
import { VbeeClient } from "../tts/vbee-client.js";
import { loadLexicon, type Lexicon } from "../tts/lexicon.js";
import { getDurationSec } from "../assets/audio-tools.js";
import {
  type WordTiming,
  charAlignmentToWords,
  edgeBoundariesToWords,
  estimateWordTimings,
  srtToWordTimings,
} from "./timing.js";
import type { LessonScript } from "./schema.js";

export type VoiceProvider = "edge-tts" | "elevenlabs" | "lucylab" | "vbee";

export interface VoiceProfile {
  profile: "free" | "clone";
  provider: VoiceProvider;
  voiceId: string;
  rate?: string | number;
  lexicon: Lexicon | null;
  lexiconId: string | null;
  /** identifies everything that changes the audio — part of the cache key */
  fingerprint: string;
}

export function resolveVoiceProfile(script: LessonScript, cfg: Config): VoiceProfile {
  const v = script.voice ?? {};
  const profile = v.profile ?? cfg.voiceProfile;
  const provider: VoiceProvider = v.provider ?? (profile === "free" ? "edge-tts" : cfg.cloneProvider);

  let voiceId = v.voiceId;
  if (!voiceId) {
    if (provider === "edge-tts") voiceId = cfg.edgeTtsVoice;
    else if (provider === "elevenlabs") voiceId = cfg.elevenlabsVoiceId;
    else if (provider === "lucylab") voiceId = cfg.lucylabVoiceId;
    else voiceId = cfg.vbeeVoiceCode;
  }
  if (!voiceId) {
    throw new Error(
      provider === "elevenlabs"
        ? "Voice profile \"clone\" needs ELEVENLABS_VOICE_ID (your cloned voice) — run `npm run voice:clone` or set it in .env.local"
        : `No voice id configured for provider ${provider}`,
    );
  }

  // Lexicon: on by default for the free Vietnamese voice; cloned voices read
  // English terms natively, so they only get one when the script asks for it.
  const lexiconId = v.lexicon === false ? null : v.lexicon ?? (provider === "edge-tts" ? "tech-vi" : null);
  const lexicon = lexiconId ? loadLexicon(lexiconId) : null;

  const rate = v.rate ?? (provider === "edge-tts" ? cfg.edgeTtsRate : undefined);
  const model = provider === "elevenlabs" ? cfg.elevenlabsModelId : "";
  const lexHash = lexicon ? createHash("sha1").update(JSON.stringify(lexicon)).digest("hex").slice(0, 8) : "none";
  return {
    profile,
    provider,
    voiceId,
    rate,
    lexicon,
    lexiconId,
    fingerprint: [provider, voiceId, model, String(rate ?? ""), lexHash].join("|"),
  };
}

export interface SynthResult {
  path: string;
  duration: number;
  words: WordTiming[];
  timing: "edge" | "elevenlabs" | "srt" | "estimate";
}

function requireKey(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") throw new Error(`Missing ${name} for the selected voice profile (set it in .env.local)`);
  return value;
}

/** Synthesize one spoken segment (text already lexicon-processed) with caching. */
export async function synthesizeSegment(
  spokenText: string,
  voiceDir: string,
  vp: VoiceProfile,
  cfg: Config,
): Promise<SynthResult> {
  await mkdir(voiceDir, { recursive: true });
  const hash = createHash("sha1").update(vp.fingerprint + "\n" + spokenText).digest("hex").slice(0, 16);
  const audio = join(voiceDir, `seg-${hash}.mp3`);
  const meta = join(voiceDir, `seg-${hash}.json`);

  if (existsSync(audio) && existsSync(meta)) {
    const cached = JSON.parse(await readFile(meta, "utf8")) as SynthResult;
    return { ...cached, path: audio };
  }

  let words: WordTiming[] | null = null;
  let timing: SynthResult["timing"] = "estimate";

  switch (vp.provider) {
    case "edge-tts": {
      const client = new EdgeTtsClient({
        voice: vp.voiceId,
        rate: typeof vp.rate === "string" ? vp.rate : cfg.edgeTtsRate,
        pitch: cfg.edgeTtsPitch,
        volume: cfg.edgeTtsVolume,
      });
      const bounds = await client.synthesizeWithWords(spokenText, audio);
      if (bounds.length > 0) {
        words = edgeBoundariesToWords(bounds);
        timing = "edge";
      }
      break;
    }
    case "elevenlabs": {
      const client = new ElevenLabsClient({
        apiKey: requireKey(cfg.elevenlabsApiKey, "ELEVENLABS_API_KEY"),
        voiceId: vp.voiceId,
        modelId: cfg.elevenlabsModelId,
        endpoint: cfg.elevenlabsEndpoint,
      });
      const alignment = await client.synthesizeWithTimestamps(spokenText, audio, {
        languageCode: "vi",
        speed: typeof vp.rate === "number" ? vp.rate : undefined,
      });
      if (alignment) {
        words = charAlignmentToWords(
          alignment.characters,
          alignment.character_start_times_seconds,
          alignment.character_end_times_seconds,
        );
        timing = "elevenlabs";
      }
      break;
    }
    case "lucylab": {
      const client = new LucylabClient({
        apiKey: requireKey(cfg.lucylabApiKey, "VIETNAMESE_API_KEY"),
        voiceId: vp.voiceId,
        endpoint: cfg.lucylabEndpoint,
        pollIntervalMs: cfg.lucylabPollIntervalMs,
        pollTimeoutMs: cfg.lucylabPollTimeoutMs,
      });
      const srt = join(voiceDir, `seg-${hash}.srt`);
      await client.generate(spokenText, audio, srt);
      if (existsSync(srt)) {
        const parsed = srtToWordTimings(await readFile(srt, "utf8"));
        if (parsed.length > 0) {
          words = parsed;
          timing = "srt";
        }
      }
      break;
    }
    case "vbee": {
      const client = new VbeeClient({
        appId: requireKey(cfg.vbeeAppId, "VBEE_APP_ID"),
        accessToken: requireKey(cfg.vbeeAccessToken, "VBEE_ACCESS_TOKEN"),
        endpoint: cfg.vbeeEndpoint,
        voiceCode: vp.voiceId,
        speedRate: typeof vp.rate === "number" ? vp.rate : cfg.vbeeSpeedRate,
        pollIntervalMs: cfg.vbeePollIntervalMs,
        pollTimeoutMs: cfg.vbeePollTimeoutMs,
      });
      await client.generate(spokenText, audio);
      break;
    }
  }

  const duration = await getDurationSec(audio);
  if (!words || words.length === 0) {
    words = estimateWordTimings(spokenText, duration);
    timing = "estimate";
  }
  const result: SynthResult = { path: audio, duration, words, timing };
  await writeFile(meta, JSON.stringify(result, null, 1));
  return result;
}
