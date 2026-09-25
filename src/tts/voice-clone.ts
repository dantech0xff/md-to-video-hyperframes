/**
 * ElevenLabs Instant Voice Cloning — POST /v1/voices/add (multipart).
 * API reference: https://elevenlabs.io/docs/api-reference/voices/ivc/create
 *
 * Samples: 1–3 minutes of clean speech in total (one voice, no music, little
 * room echo), several files are fine. The returned voice_id goes into
 * ELEVENLABS_VOICE_ID for the lesson voice profile "clone".
 */
import axios, { AxiosError } from "axios";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
};

export interface CloneVoiceOpts {
  apiKey: string;
  /** default https://api.elevenlabs.io/v1 */
  endpoint?: string;
  name: string;
  files: string[];
  description?: string;
  removeBackgroundNoise?: boolean;
  labels?: Record<string, string>;
}

export interface CloneVoiceResult {
  voiceId: string;
  requiresVerification: boolean;
}

export async function cloneVoiceElevenLabs(o: CloneVoiceOpts): Promise<CloneVoiceResult> {
  if (o.files.length === 0) throw new Error("voice clone needs at least one sample file");
  const form = new FormData();
  form.append("name", o.name);
  if (o.description) form.append("description", o.description);
  if (o.removeBackgroundNoise) form.append("remove_background_noise", "true");
  if (o.labels) form.append("labels", JSON.stringify(o.labels));
  for (const f of o.files) {
    const buf = await readFile(f);
    const type = MIME[extname(f).toLowerCase()] ?? "application/octet-stream";
    form.append("files", new Blob([buf], { type }), basename(f));
  }
  const endpoint = (o.endpoint ?? "https://api.elevenlabs.io/v1").replace(/\/$/, "");
  try {
    const resp = await axios.post<{ voice_id: string; requires_verification?: boolean }>(`${endpoint}/voices/add`, form, {
      headers: { "xi-api-key": o.apiKey },
      timeout: 180000,
      maxBodyLength: Infinity,
    });
    if (!resp.data?.voice_id) throw new Error("ElevenLabs returned no voice_id");
    return { voiceId: resp.data.voice_id, requiresVerification: !!resp.data.requires_verification };
  } catch (e) {
    const err = e as AxiosError<{ detail?: { message?: string; status?: string } | string }>;
    if (err.response) {
      const d = err.response.data?.detail;
      const msg = typeof d === "string" ? d : d?.message ?? JSON.stringify(err.response.data);
      throw new Error(`ElevenLabs voice clone failed (HTTP ${err.response.status}): ${msg}`);
    }
    throw e;
  }
}

/** Set KEY=value lines in env-file text: replaces existing keys (commented or not), appends the rest. */
export function upsertEnv(text: string, values: Record<string, string>): string {
  const lines = text.split(/\r?\n/);
  const done = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*#?\s*([A-Z0-9_]+)\s*=/.exec(lines[i]);
    if (m && m[1] in values && !done.has(m[1])) {
      lines[i] = `${m[1]}=${values[m[1]]}`;
      done.add(m[1]);
    }
  }
  const rest = Object.keys(values).filter((k) => !done.has(k));
  if (rest.length) {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length) lines.push("");
    for (const k of rest) lines.push(`${k}=${values[k]}`);
  }
  return lines.join("\n") + "\n";
}
