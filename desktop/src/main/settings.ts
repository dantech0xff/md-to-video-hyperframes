/**
 * Settings: settings.json in the app's data folder, and the voice keys in
 * secrets.bin, encrypted with Electron's safeStorage (Keychain on macOS, DPAPI
 * on Windows). The renderer only ever learns whether a key is set.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isAgentId } from "../shared/agents";
import { isBrandId } from "../shared/brands";
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
    brand: "dan-tech",
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
    paths: { ffmpeg: "", ffprobe: "", claude: "", codex: "", devin: "" },
    setupDone: false,
  };
}

/**
 * The folders and programs a change would newly point at that the user did
 * not pick in a native dialog. The app serves files from the projects folder
 * and runs these programs, so only the user chooses them, never the page.
 */
export function unpickedPaths(patch: SettingsPatch, now: Settings, picked: ReadonlySet<string>): string[] {
  const s = patch.settings ?? {};
  const wanted: string[] = [];
  if (s.projectsDir !== undefined && s.projectsDir !== now.projectsDir) wanted.push(s.projectsDir);
  for (const key of ["ffmpeg", "ffprobe", "claude", "codex", "devin"] as const) {
    const value = s.paths?.[key];
    // "" goes back to finding the program by itself
    if (value && value !== now.paths[key]) wanted.push(value);
  }
  return wanted.filter((p) => !picked.has(p));
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

  /** Saves a change: all of it, or (when the keys cannot be encrypted) nothing. */
  save(patch: SettingsPatch): SettingsView {
    const s = patch.settings ?? {};
    if (s.agent !== undefined && !isAgentId(s.agent)) throw new Error(`Không có agent "${String(s.agent)}"`);
    if (s.brand !== undefined && !isBrandId(s.brand)) throw new Error(`Không có brand kit "${String(s.brand)}"`);
    const settings: Settings = {
      ...this.settings,
      ...(s.projectsDir !== undefined ? { projectsDir: s.projectsDir } : {}),
      ...(s.agent !== undefined ? { agent: s.agent } : {}),
      ...(s.brand !== undefined ? { brand: s.brand } : {}),
      ...(s.setupDone !== undefined ? { setupDone: s.setupDone } : {}),
      voice: { ...this.settings.voice, ...s.voice },
      paths: { ...this.settings.paths, ...s.paths },
    };
    let secrets: Partial<Record<SecretKey, string>> | undefined;
    let encrypted: Buffer | undefined;
    if (patch.secrets && Object.keys(patch.secrets).length) {
      secrets = { ...this.secrets };
      for (const key of SECRET_KEYS) {
        const value = patch.secrets[key];
        if (value === null || value === "") delete secrets[key];
        else if (value !== undefined) secrets[key] = value.trim();
      }
      if (Object.keys(secrets).length) {
        if (!this.crypto.isEncryptionAvailable()) throw new Error("Máy này không có kho khoá của hệ điều hành, nên app không lưu được key.");
        encrypted = this.crypto.encryptString(JSON.stringify(secrets));
      }
    }

    // written aside, then swapped in, the keys first: a failure on the way changes nothing
    const settingsTmp = `${this.files.settings}.tmp`;
    const secretsTmp = `${this.files.secrets}.tmp`;
    try {
      write(settingsTmp, `${JSON.stringify(settings, null, 2)}\n`);
      if (encrypted) write(secretsTmp, encrypted);
      if (encrypted) renameSync(secretsTmp, this.files.secrets);
      else if (secrets) rmSync(this.files.secrets, { force: true });
    } catch (e) {
      rmSync(settingsTmp, { force: true });
      rmSync(secretsTmp, { force: true });
      throw e;
    }
    renameSync(settingsTmp, this.files.settings);
    this.settings = settings;
    if (secrets) this.secrets = secrets;
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
      const settings = { ...d, ...saved, voice: { ...d.voice, ...saved.voice }, paths: { ...d.paths, ...saved.paths } };
      // an agent this version does not know (settings from a newer one), or a brand id that is not one: the default
      return { ...settings, agent: isAgentId(settings.agent) ? settings.agent : d.agent, brand: isBrandId(settings.brand) ? settings.brand : d.brand };
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
