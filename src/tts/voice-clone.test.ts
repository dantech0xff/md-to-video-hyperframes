import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cloneVoiceElevenLabs, upsertEnv } from "./voice-clone.js";

describe("upsertEnv", () => {
  it("replaces keys (also commented ones), keeps the rest, appends new keys", () => {
    const out = upsertEnv("A=1\n# ELEVENLABS_VOICE_ID=old\nB=2\n", { ELEVENLABS_VOICE_ID: "new", CLONE_PROVIDER: "elevenlabs" });
    expect(out).toBe("A=1\nELEVENLABS_VOICE_ID=new\nB=2\n\nCLONE_PROVIDER=elevenlabs\n");
    expect(upsertEnv("", { X: "1" })).toBe("X=1\n");
  });
});

describe("cloneVoiceElevenLabs", () => {
  let dir: string;
  beforeEach(() => {
    nock.cleanAll();
    dir = mkdtempSync(join(tmpdir(), "clone-"));
    writeFileSync(join(dir, "dan-01.mp3"), "FAKEAUDIO");
  });
  afterEach(() => {
    nock.cleanAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it("uploads the samples as multipart and returns the voice id", async () => {
    let body = "";
    nock("https://api.elevenlabs.io")
      .post("/v1/voices/add", (b: unknown) => {
        body = typeof b === "string" ? b : Buffer.isBuffer(b) ? b.toString() : JSON.stringify(b);
        return true;
      })
      .matchHeader("xi-api-key", "sk_test")
      .reply(200, { voice_id: "voice123", requires_verification: false });

    const r = await cloneVoiceElevenLabs({ apiKey: "sk_test", name: "Dan Tech", files: [join(dir, "dan-01.mp3")], removeBackgroundNoise: true });
    expect(r).toEqual({ voiceId: "voice123", requiresVerification: false });
    expect(body).toContain('name="name"');
    expect(body).toContain("Dan Tech");
    expect(body).toContain('filename="dan-01.mp3"');
    expect(body).toContain('name="remove_background_noise"');
  });

  it("surfaces the API error message", async () => {
    nock("https://api.elevenlabs.io").post("/v1/voices/add").reply(400, { detail: { status: "voice_limit_reached", message: "Voice limit reached" } });
    await expect(cloneVoiceElevenLabs({ apiKey: "k", name: "x", files: [join(dir, "dan-01.mp3")] })).rejects.toThrow(/HTTP 400.*Voice limit reached/);
  });

  it("needs at least one sample", async () => {
    await expect(cloneVoiceElevenLabs({ apiKey: "k", name: "x", files: [] })).rejects.toThrow(/at least one sample/);
  });
});
