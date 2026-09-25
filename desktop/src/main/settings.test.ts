import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSettings, SettingsStore, unpickedPaths, type Encryption } from "./settings";

/** Reversible stand-in for safeStorage. */
const fakeCrypto = (available = true): Encryption => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString("base64")}`),
  decryptString: (b) => Buffer.from(b.toString().replace(/^enc:/, ""), "base64").toString(),
});

async function files() {
  const dir = await mkdtemp(join(tmpdir(), "settings-"));
  return { settings: join(dir, "settings.json"), secrets: join(dir, "secrets.bin") };
}

describe("SettingsStore", () => {
  it("starts from the defaults and keeps what is saved", async () => {
    const f = await files();
    const store = new SettingsStore(f, fakeCrypto(), defaultSettings("/Users/dan/Movies/Get Frames"));
    expect(store.get()).toMatchObject({ projectsDir: "/Users/dan/Movies/Get Frames", agent: "claude-code", voice: { profile: "free" }, setupDone: false });
    store.save({ settings: { voice: { freeVoice: "vi-VN-HoaiMyNeural" }, paths: { ffmpeg: "/opt/homebrew/bin/ffmpeg" }, setupDone: true } });
    const reopened = new SettingsStore(f, fakeCrypto(), defaultSettings("/elsewhere"));
    expect(reopened.get()).toMatchObject({
      projectsDir: "/Users/dan/Movies/Get Frames",
      voice: { profile: "free", freeVoice: "vi-VN-HoaiMyNeural", elevenlabsModelId: "eleven_v3" },
      paths: { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "", claude: "" },
      setupDone: true,
    });
  });

  it("encrypts keys and only says whether they are set", async () => {
    const f = await files();
    const store = new SettingsStore(f, fakeCrypto(), defaultSettings("/p"));
    const view = store.save({ secrets: { elevenlabsApiKey: "  sk_live_123  " } });
    expect(view.secrets).toEqual({ elevenlabsApiKey: true, lucylabApiKey: false, vbeeAccessToken: false });
    expect(JSON.stringify(view)).not.toContain("sk_live_123");
    expect(readFileSync(f.secrets, "utf8")).not.toContain("sk_live_123");
    expect(new SettingsStore(f, fakeCrypto(), defaultSettings("/p")).secret("elevenlabsApiKey")).toBe("sk_live_123");

    store.save({ secrets: { elevenlabsApiKey: null } });
    expect(store.secret("elevenlabsApiKey")).toBeUndefined();
    expect(existsSync(f.secrets)).toBe(false);
  });

  it("refuses to keep keys without the OS keychain, and then saves nothing of the change", async () => {
    const f = await files();
    const store = new SettingsStore(f, fakeCrypto(false), defaultSettings("/p"));
    expect(store.view().encryption).toBe(false);
    expect(() => store.save({ secrets: { lucylabApiKey: "k" } })).toThrow(/kho khoá/);
    expect(() => store.save({ settings: { voice: { freeVoice: "vi-VN-HoaiMyNeural" } }, secrets: { elevenlabsApiKey: "k" } })).toThrow(/kho khoá/);
    expect(store.get().voice.freeVoice).toBe("vi-VN-NamMinhNeural");
    expect(existsSync(f.settings)).toBe(false);
    // what needs no key is saved
    store.save({ settings: { voice: { freeVoice: "vi-VN-HoaiMyNeural" } } });
    expect(new SettingsStore(f, fakeCrypto(false), defaultSettings("/p")).get().voice.freeVoice).toBe("vi-VN-HoaiMyNeural");
  });

  it("takes new folders and programs only when the user picked them", () => {
    const now = defaultSettings("/Users/dan/Movies/Get Frames");
    const picked = new Set(["/Volumes/Work/Videos", "/opt/homebrew/bin/ffmpeg"]);
    expect(unpickedPaths({ settings: { projectsDir: "/Volumes/Work/Videos", paths: { ffmpeg: "/opt/homebrew/bin/ffmpeg" } } }, now, picked)).toEqual([]);
    expect(unpickedPaths({ settings: { projectsDir: "/Users/dan/.ssh", paths: { claude: "/tmp/evil" } } }, now, picked)).toEqual(["/Users/dan/.ssh", "/tmp/evil"]);
    // unchanged values, going back to automatic, and the rest of the settings need no pick
    expect(unpickedPaths({ settings: { projectsDir: now.projectsDir, paths: { claude: "" }, voice: { freeVoice: "x" }, setupDone: true } }, now, picked)).toEqual([]);
    expect(unpickedPaths({ settings: { projectsDir: "" } }, now, picked)).toEqual([""]);
  });

  it("gives the engine its voice environment", async () => {
    const store = new SettingsStore(await files(), fakeCrypto(), defaultSettings("/p"));
    store.save({
      settings: { voice: { profile: "clone", cloneProvider: "lucylab", lucylabVoiceId: "v-123" } },
      secrets: { lucylabApiKey: "lucy-key" },
    });
    expect(store.engineEnv()).toMatchObject({
      TTS_PROVIDER: "edge-tts",
      VOICE_PROFILE: "clone",
      CLONE_PROVIDER: "lucylab",
      EDGE_TTS_VOICE: "vi-VN-NamMinhNeural",
      VIETNAMESE_API_KEY: "lucy-key",
      VIETNAMESE_VOICEID: "v-123",
      // unset values remove the variable
      ELEVENLABS_API_KEY: null,
      ELEVENLABS_VOICE_ID: null,
      VBEE_ACCESS_TOKEN: null,
    });
  });
});
