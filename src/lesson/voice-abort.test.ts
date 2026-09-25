import { describe, it, expect, vi } from "vitest";
import { copyFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { synthesizeSegment, type VoiceProfile } from "./voice.js";

// a provider call we can hold open: Edge TTS writes its file once released
const tts = vi.hoisted(() => ({ release: undefined as undefined | (() => void) }));
vi.mock("../tts/edge-tts-client.js", () => ({
  EdgeTtsClient: class {
    async synthesizeWithWords(_text: string, out: string) {
      await new Promise<void>((r) => (tts.release = r));
      await copyFile("tests/fixtures/sample-audio-1.mp3", out);
      return [];
    }
  },
}));

const voice = { profile: "free", provider: "edge-tts", voiceId: "vi-VN-HoaiMyNeural", lexicon: null, lexiconId: null, fingerprint: "test" } as VoiceProfile;

async function started(): Promise<() => void> {
  tts.release = undefined;
  await vi.waitFor(() => expect(tts.release).toBeTypeOf("function"));
  return tts.release!;
}

describe("synthesizeSegment", () => {
  it("renames the finished file into the cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "voice-"));
    const run = synthesizeSegment("xin chào", dir, voice, loadConfig());
    (await started())();
    const res = await run;
    expect(res.path).toMatch(/seg-[0-9a-f]{16}\.mp3$/);
    expect((await readdir(dir)).sort()).toEqual([res.path.split(/[\\/]/).pop(), res.path.split(/[\\/]/).pop()!.replace(".mp3", ".json")].sort());
  });

  it("stops waiting on abort and leaves no partial segment behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "voice-"));
    const ac = new AbortController();
    const run = synthesizeSegment("xin chào", dir, voice, loadConfig(), ac.signal);
    const release = await started();
    ac.abort(new Error("cancelled"));
    await expect(run).rejects.toThrow("cancelled");
    // the provider call ends later, into its temporary file, which is then deleted
    release();
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
  });
});
