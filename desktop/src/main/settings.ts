/**
 * Settings: settings.json in the app's data folder, and the voice keys in
 * secrets.bin, encrypted with Electron's safeStorage (Keychain on macOS, DPAPI
 * on Windows). The renderer only ever learns whether a key is set.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SECRET_KEYS, type SecretKey, type Settings, type SettingsPatch, type SettingsView } from "../shared/types";

/** The part of Electron's safeStorage the store uses. */
export interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function defaultSettings(projectsDir: string): Settings {
  return {
    projectsDir,
    agent: "claude-code",
    voice: {
      profile: "free",
      freeVoice: "vi-VN-NamMinhNeural",
      cloneProvider: "elevenlabs",
      elevenlabsVoiceId: "",
      elevenlabsModelId: "eleven_v3",
      lucylabVoiceId: "",
      vbeeAppId: "",
      vbeeVoiceCode: "",
    },
    paths: { ffmpeg: "", ffprobe: "", claude: "" },
    setupDone: false,
  };
}

export class SettingsStore {
  private settings: Settings;
  private secrets: Partial<Record<SecretKey, string>>;

  constructor(
    private readonly files: { settings: string; secrets: string },
    private readonly crypto: Encryption,
    private readonly defaults: Settings,
  ) {
    this.settings = this.readSettings();
    this.secrets = this.readSecrets();
  }

  get(): Settings {
    return this.settings;
  }

  secret(key: SecretKey): string | undefined {
    return this.secrets[key];
  }

  view(): SettingsView {
    return {
      ...structuredClone(this.settings),
      secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, !!this.secrets[k]])) as Record<SecretKey, boolean>,
      encryption: this.crypto.isEncryptionAvailable(),
    };
  }

  save(patch: SettingsPatch): SettingsView {
    const s = patch.settings ?? {};
    this.settings = {
      ...this.settings,
      ...(s.projectsDir !== undefined ? { projectsDir: s.projectsDir } : {}),
      ...(s.agent !== undefined ? { agent: s.agent } : {}),
      ...(s.setupDone !== undefined ? { setupDone: s.setupDone } : {}),
      voice: { ...this.settings.voice, ...s.voice },
      paths: { ...this.settings.paths, ...s.paths },
    };
    write(this.files.settings, `${JSON.stringify(this.settings, null, 2)}\n`);

    if (patch.secrets && Object.keys(patch.secrets).length) {
      const next = { ...this.secrets };
      for (const key of SECRET_KEYS) {
        const value = patch.secrets[key];
        if (value === null || value === "") delete next[key];
        else if (value !== undefined) next[key] = value.trim();
      }
      if (Object.keys(next).length === 0) rmSync(this.files.secrets, { force: true });
      else if (!this.crypto.isEncryptionAvailable()) throw new Error("Máy này không có kho khoá của hệ điều hành, nên app không lưu được key.");
      else write(this.files.secrets, this.crypto.encryptString(JSON.stringify(next)));
      this.secrets = next;
    }
    return this.view();
  }

  /**
   * The engine's environment for voices: what loadConfig() reads. null removes
   * a variable (a key the user deleted). Legacy TTS_PROVIDER stays edge-tts,
   * so a paid provider's missing keys never block a lesson.
   */
  engineEnv(): Record<string, string | null> {
    const v = this.settings.voice;
    const opt = (value: string | undefined) => (value ? value : null);
    return {
      TTS_PROVIDER: "edge-tts",
      VOICE_PROFILE: v.profile,
      EDGE_TTS_VOICE: v.freeVoice,
      CLONE_PROVIDER: v.cloneProvider,
      ELEVENLABS_API_KEY: opt(this.secrets.elevenlabsApiKey),
      ELEVENLABS_VOICE_ID: opt(v.elevenlabsVoiceId),
      ELEVENLABS_MODEL_ID: opt(v.elevenlabsModelId),
      VIETNAMESE_API_KEY: opt(this.secrets.lucylabApiKey),
      VIETNAMESE_VOICEID: opt(v.lucylabVoiceId),
      VBEE_APP_ID: opt(v.vbeeAppId),
      VBEE_ACCESS_TOKEN: opt(this.secrets.vbeeAccessToken),
      VBEE_VOICE_CODE: opt(v.vbeeVoiceCode),
    };
  }

  private readSettings(): Settings {
    const d = this.defaults;
    try {
      const saved = JSON.parse(readFileSync(this.files.settings, "utf8")) as Partial<Settings>;
      return { ...d, ...saved, voice: { ...d.voice, ...saved.voice }, paths: { ...d.paths, ...saved.paths } };
    } catch {
      return structuredClone(d);
    }
  }

  private readSecrets(): Partial<Record<SecretKey, string>> {
    if (!existsSync(this.files.secrets) || !this.crypto.isEncryptionAvailable()) return {};
    try {
      return JSON.parse(this.crypto.decryptString(readFileSync(this.files.secrets))) as Partial<Record<SecretKey, string>>;
    } catch {
      // encrypted by another user account or machine: start without keys
      return {};
    }
  }
}

function write(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data, typeof data === "string" ? undefined : { mode: 0o600 });
}
