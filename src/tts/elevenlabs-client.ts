import axios, { AxiosError } from "axios";
import { writeFile } from "node:fs/promises";
import type { TtsClient } from "./tts-client.js";

export interface ElevenLabsOpts {
  apiKey: string;
  voiceId: string;
  modelId: string;       // e.g. "eleven_v3", "eleven_flash_v2_5" (both support Vietnamese)
  endpoint: string;      // e.g. "https://api.elevenlabs.io/v1"
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ElevenLabs TTS client.
 *
 * API reference: https://elevenlabs.io/docs/api-reference/text-to-speech
 *
 * Synchronous: POST text → returns mp3 binary directly. No polling needed.
 * Vietnamese needs `eleven_v3` (default) or `eleven_flash_v2_5` —
 * `eleven_multilingual_v2` does NOT list Vietnamese among its languages.
 *
 * Note: ElevenLabs does NOT return SRT subtitles in TTS endpoint.
 * `srtOutPath` arg is ignored silently.
 */
export interface ElevenLabsTimestampOpts {
  /** ISO 639-1 code, e.g. "vi" — ignored by eleven_multilingual_v2 */
  languageCode?: string;
  /** voice_settings.speed (0.7–1.2) */
  speed?: number;
}

export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export class ElevenLabsClient implements TtsClient {
  constructor(private cfg: ElevenLabsOpts) {}

  async generate(text: string, audioOutPath: string, _srtOutPath?: string): Promise<void> {
    await this.synthesizeWithRetry(text, audioOutPath);
    // ElevenLabs has no SRT — silently skip srtOutPath.
  }

  /**
   * POST /text-to-speech/{voice}/with-timestamps → mp3 + character alignment.
   * Returns null alignment (after writing plain audio) when the endpoint
   * rejects the request, so callers can fall back to estimated timings.
   */
  async synthesizeWithTimestamps(
    text: string,
    audioOutPath: string,
    opts: ElevenLabsTimestampOpts = {},
  ): Promise<ElevenLabsAlignment | null> {
    const body: Record<string, unknown> = {
      text,
      model_id: this.cfg.modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.0,
        use_speaker_boost: true,
        ...(opts.speed ? { speed: opts.speed } : {}),
      },
    };
    if (opts.languageCode && !this.cfg.modelId.startsWith("eleven_multilingual_v2")) {
      body.language_code = opts.languageCode;
    }
    const delays = [1000, 2000, 4000];
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const resp = await axios.post<{ audio_base64: string; alignment?: ElevenLabsAlignment; normalized_alignment?: ElevenLabsAlignment }>(
          `${this.cfg.endpoint}/text-to-speech/${this.cfg.voiceId}/with-timestamps`,
          body,
          {
            headers: { "xi-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
            timeout: 90000,
          },
        );
        await writeFile(audioOutPath, Buffer.from(resp.data.audio_base64, "base64"));
        return resp.data.alignment ?? resp.data.normalized_alignment ?? null;
      } catch (e) {
        const status = (e as AxiosError).response?.status;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (status && status >= 400 && status < 500 && status !== 429 && status !== 401) {
          // endpoint/model combination not supported → plain synthesis, no alignment
          await this.synthesizeWithRetry(text, audioOutPath);
          return null;
        }
        if (!retryable || attempt === delays.length) {
          throw new Error(`ElevenLabs with-timestamps failed (status ${status ?? "?"}): ${(e as Error).message}`);
        }
        await sleep(delays[attempt]);
      }
    }
    return null;
  }

  private async synthesizeWithRetry(text: string, outPath: string): Promise<void> {
    const delays = [1000, 2000, 4000];
    let lastErr: unknown;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const url = `${this.cfg.endpoint}/text-to-speech/${this.cfg.voiceId}`;
        const resp = await axios.post<ArrayBuffer>(
          url,
          {
            text,
            model_id: this.cfg.modelId,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
            },
          },
          {
            headers: {
              "xi-api-key": this.cfg.apiKey,
              "Content-Type": "application/json",
              "Accept": "audio/mpeg",
            },
            responseType: "arraybuffer",
            timeout: 60000,
          },
        );
        await writeFile(outPath, Buffer.from(resp.data));
        return;
      } catch (e) {
        lastErr = e;
        const err = e as AxiosError;
        const status = err.response?.status;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt === delays.length) {
          // Try to extract ElevenLabs error message from response body
          let detail = err.message;
          if (err.response?.data) {
            try {
              const body = err.response.data instanceof ArrayBuffer
                ? Buffer.from(err.response.data).toString("utf8")
                : String(err.response.data);
              const parsed = JSON.parse(body);
              detail = parsed?.detail?.message ?? parsed?.detail ?? detail;
            } catch { /* ignore parse errors */ }
          }
          throw new Error(`ElevenLabs TTS failed (status ${status ?? "?"}): ${detail}`);
        }
        await sleep(delays[attempt]);
      }
    }
    throw lastErr;
  }
}
