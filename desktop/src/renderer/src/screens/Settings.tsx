/** Settings: projects folder, voices and keys (design doc §1: users bring their own keys), tools, about. */
import { useEffect, useState } from "react";
import { FolderOpen, KeyRound, Save } from "lucide-react";
import type { SecretKey, SettingsView, SetupStatus, VoiceSettings } from "../../../shared/types";
import { invoke } from "../lib/api";
import { Banner, ErrorBanner, Spinner, useAction, useLoad } from "../components/ui";
import { ToolChecks } from "./Setup";

const FREE_VOICES = [
  { id: "vi-VN-NamMinhNeural", name: "Nam Minh (nam)" },
  { id: "vi-VN-HoaiMyNeural", name: "Hoài My (nữ)" },
];

export function SettingsScreen() {
  const settings = useLoad(() => invoke("settings:get"), []);
  const setup = useLoad(() => invoke("setup:status"), []);
  const info = useLoad(() => invoke("app:info"), []);
  const [status, setStatus] = useState<SetupStatus | undefined>();
  useEffect(() => setStatus(setup.data), [setup.data]);

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-header">
        <div>
          <h1>Cài đặt</h1>
          <p className="sub">Key giọng đọc được mã hoá bằng kho khoá của hệ điều hành và chỉ lưu trên máy này.</p>
        </div>
      </div>
      <ErrorBanner error={settings.error ?? setup.error} />
      {settings.data ? <SettingsForm initial={settings.data} onSaved={() => void setup.reload()} /> : <Spinner />}

      <h2>Công cụ</h2>
      {status ? <ToolChecks status={status} onChange={setStatus} /> : <Spinner />}

      <h2>Giới thiệu</h2>
      <div className="card">
        <div className="card-body stack tight small">
          <span>
            Get Frames {info.data?.version} · engine {info.data?.engineVersion} · miễn phí, mã nguồn mở
          </span>
          <span className="muted">
            Dữ liệu của app: <span className="mono">{info.data?.userData}</span>
          </span>
          <span className="muted">
            Giọng miễn phí dùng dịch vụ đọc văn bản không chính thức của Microsoft Edge (qua thư viện edge-tts-universal, AGPL-3.0): có thể ngừng hoạt động bất cứ lúc nào. Giọng nhập key (ElevenLabs, LucyLab, Vbee) là phương án chắc chắn.
          </span>
          <span className="muted">
            Render bằng HyperFrames (Apache-2.0), GSAP, Chrome headless và FFmpeg. Agent là bản Claude Code, Codex hoặc Devin bạn tự cài, dùng tài khoản của bạn; app nói chuyện với
            chúng qua Agent Client Protocol (Claude Code và Codex qua adapter mã nguồn mở của dự án ACP).
          </span>
        </div>
      </div>
    </div>
  );
}

type SecretInputs = Partial<Record<SecretKey, string | null>>;

function SettingsForm({ initial, onSaved }: { initial: SettingsView; onSaved: () => void }) {
  const [view, setView] = useState(initial);
  const [voice, setVoice] = useState<VoiceSettings>(initial.voice);
  const [secrets, setSecrets] = useState<SecretInputs>({});
  const [saved, setSaved] = useState(false);
  const save = useAction();
  const set = (patch: Partial<VoiceSettings>) => {
    setVoice((v) => ({ ...v, ...patch }));
    setSaved(false);
  };

  const submit = () =>
    save.run(async () => {
      const next = await invoke("settings:save", { settings: { voice }, secrets });
      setView(next);
      setSecrets({});
      setSaved(true);
      onSaved();
    });

  const pickFolder = () =>
    save.run(async () => {
      const dir = await invoke("dialog:folder", "Thư mục chứa dự án video");
      if (dir) setView(await invoke("settings:save", { settings: { projectsDir: dir } }));
    });

  const secret = (key: SecretKey, label: string) => (
    <label className="field">
      {label}
      <div className="key-field">
        <input
          type="password"
          placeholder={view.secrets[key] && secrets[key] === undefined ? "Đã lưu (nhập để thay)" : "Chưa có"}
          value={typeof secrets[key] === "string" ? (secrets[key] as string) : ""}
          onChange={(e) => {
            setSecrets((s) => ({ ...s, [key]: e.target.value }));
            setSaved(false);
          }}
        />
        {view.secrets[key] && (
          <button
            className="btn small danger"
            onClick={() => {
              setSecrets((s) => ({ ...s, [key]: null }));
              setSaved(false);
            }}
          >
            Xoá
          </button>
        )}
      </div>
      {secrets[key] === null && <span className="hint">Sẽ xoá khi bấm Lưu</span>}
    </label>
  );

  return (
    <>
      <div className="card">
        <div className="card-body stack">
          <h2>Thư mục dự án</h2>
          <div className="row">
            <span className="mono small ellipsis grow">{view.projectsDir}</span>
            <button className="btn small" onClick={() => void pickFolder()}>
              <FolderOpen size={13} /> Đổi…
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <h2>Giọng đọc</h2>
            <span className="small muted row">
              <KeyRound size={13} /> Kịch bản có thể chọn riêng giọng; đây là mặc định
            </span>
          </div>
          {!view.encryption && <Banner kind="warn">Máy này không có kho khoá của hệ điều hành nên không lưu được key.</Banner>}
          <div className="settings-grid">
            <label className="field">
              Giọng mặc định
              <select value={voice.profile} onChange={(e) => set({ profile: e.target.value as VoiceSettings["profile"] })}>
                <option value="free">Miễn phí (Edge TTS)</option>
                <option value="clone">Giọng clone</option>
              </select>
            </label>
            <label className="field">
              Giọng miễn phí
              <select value={voice.freeVoice} onChange={(e) => set({ freeVoice: e.target.value })}>
                {FREE_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Dịch vụ giọng clone
              <select value={voice.cloneProvider} onChange={(e) => set({ cloneProvider: e.target.value as VoiceSettings["cloneProvider"] })}>
                <option value="elevenlabs">ElevenLabs</option>
                <option value="lucylab">LucyLab</option>
              </select>
            </label>
          </div>

          <h3>ElevenLabs</h3>
          <div className="settings-grid">
            {secret("elevenlabsApiKey", "API key")}
            <label className="field">
              <span className="field-label">
                Voice ID <span className="hint">giọng clone của bạn</span>
              </span>
              <input type="text" value={voice.elevenlabsVoiceId} onChange={(e) => set({ elevenlabsVoiceId: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">
                Model <span className="hint">tiếng Việt cần eleven_v3 hoặc eleven_flash_v2_5</span>
              </span>
              <input type="text" value={voice.elevenlabsModelId} onChange={(e) => set({ elevenlabsModelId: e.target.value })} />
            </label>
          </div>

          <h3>LucyLab</h3>
          <div className="settings-grid">
            {secret("lucylabApiKey", "API key")}
            <label className="field">
              Voice ID
              <input type="text" value={voice.lucylabVoiceId} onChange={(e) => set({ lucylabVoiceId: e.target.value })} />
            </label>
          </div>

          <h3>Vbee</h3>
          <div className="settings-grid">
            <label className="field">
              App ID
              <input type="text" value={voice.vbeeAppId} onChange={(e) => set({ vbeeAppId: e.target.value })} />
            </label>
            {secret("vbeeAccessToken", "Access token")}
            <label className="field">
              Voice code
              <input type="text" placeholder="n_hanoi_male_protrainer_education_vc" value={voice.vbeeVoiceCode} onChange={(e) => set({ vbeeVoiceCode: e.target.value })} />
            </label>
          </div>

          <ErrorBanner error={save.error} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            {saved && <span className="small muted">Đã lưu</span>}
            <button className="btn primary" disabled={save.busy} onClick={() => void submit()}>
              <Save size={14} /> Lưu
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
