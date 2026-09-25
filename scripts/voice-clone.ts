/**
 * Clone the instructor's voice on ElevenLabs (Instant Voice Cloning).
 *
 *   npm run voice:clone -- --name "Dan Tech – giọng giảng" samples/dan-01.mp3 samples/dan-02.mp3 [options]
 *
 *   --name "…"          voice name on ElevenLabs (required)
 *   --description "…"   optional description
 *   --denoise           let ElevenLabs remove background noise from the samples
 *   --save              write ELEVENLABS_VOICE_ID + CLONE_PROVIDER=elevenlabs into .env.local
 *   --test "câu thử"    synthesize a test sentence with the new voice → output/voice-clone-test.mp3
 *
 * Samples: 1–3 minutes of clean speech in total, one speaker, no music.
 * Lessons then use it with `"voice": { "profile": "clone" }` (or VOICE_PROFILE=clone).
 *
 * LucyLab: create the cloned voice at https://lucylab.io, then set
 * VIETNAMESE_API_KEY, VIETNAMESE_VOICEID and CLONE_PROVIDER=lucylab in .env.local.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloneVoiceElevenLabs, upsertEnv } from "../src/tts/voice-clone.js";
import { ElevenLabsClient } from "../src/tts/elevenlabs-client.js";
import { getDurationSec } from "../src/assets/audio-tools.js";

function parse(argv: string[]) {
  const o = { name: "", description: "", denoise: false, save: false, test: "", files: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") o.name = argv[++i] ?? "";
    else if (a === "--description") o.description = argv[++i] ?? "";
    else if (a === "--denoise") o.denoise = true;
    else if (a === "--save") o.save = true;
    else if (a === "--test") o.test = argv[++i] ?? "";
    else if (!a.startsWith("--")) o.files.push(a);
  }
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (!o.name || o.files.length === 0) {
    console.error('Usage: npm run voice:clone -- --name "Tên giọng" sample1.mp3 [sample2.mp3 …] [--denoise] [--save] [--test "câu thử"]');
    process.exit(2);
  }
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    console.error("Missing ELEVENLABS_API_KEY in .env.local (https://elevenlabs.io/app/settings/api-keys)");
    process.exit(2);
  }
  const missing = o.files.filter((f) => !existsSync(f));
  if (missing.length) {
    console.error(`Sample file(s) not found: ${missing.join(", ")}`);
    process.exit(2);
  }

  let total = 0;
  for (const f of o.files) total += await getDurationSec(f).catch(() => 0);
  console.log(`Samples: ${o.files.length} file(s), ${total.toFixed(0)}s of audio`);
  if (total > 0 && total < 45) console.warn("⚠ Under ~1 minute of speech — the clone may sound unstable. 1–3 minutes works best.");

  const endpoint = process.env.ELEVENLABS_ENDPOINT ?? "https://api.elevenlabs.io/v1";
  const res = await cloneVoiceElevenLabs({
    apiKey,
    endpoint,
    name: o.name,
    files: o.files,
    description: o.description || undefined,
    removeBackgroundNoise: o.denoise,
    labels: { language: "vi", use_case: "education" },
  });
  console.log(`\n✓ Voice created: ${res.voiceId}`);
  if (res.requiresVerification) console.warn("⚠ ElevenLabs requires verification for this voice before use (see your Voice Lab).");

  if (o.save) {
    const envPath = ".env.local";
    const text = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
    await writeFile(envPath, upsertEnv(text, { ELEVENLABS_VOICE_ID: res.voiceId, CLONE_PROVIDER: "elevenlabs" }));
    console.log(`  saved ELEVENLABS_VOICE_ID + CLONE_PROVIDER=elevenlabs → ${envPath}`);
  } else {
    console.log(`  add to .env.local:  ELEVENLABS_VOICE_ID=${res.voiceId}`);
  }
  console.log('  use it in a lesson: "voice": { "profile": "clone" }   (or VOICE_PROFILE=clone for every lesson)');

  if (o.test) {
    const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3";
    const client = new ElevenLabsClient({ apiKey, voiceId: res.voiceId, modelId, endpoint });
    await mkdir("output", { recursive: true });
    const out = join("output", "voice-clone-test.mp3");
    await client.synthesizeWithTimestamps(o.test, out, { languageCode: "vi" });
    console.log(`  test sentence (${modelId}) → ${out}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
