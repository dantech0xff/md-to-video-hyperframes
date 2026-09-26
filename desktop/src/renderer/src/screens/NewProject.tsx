/** Design doc §3, step 1: topic, material (files, links, pasted text), video type, brand kit, style, voice and agent. */
import { useState } from "react";
import { FilePlus2, Link2, Sparkles, X } from "lucide-react";
import { hasTextMaterial } from "../../../shared/material";
import { SOURCE_EXTENSIONS, type AgentId, type NewProjectRequest, type VideoKind, type VoiceProfile } from "../../../shared/types";
import { invoke } from "../lib/api";
import { newVideoAgent, newVideoVoice } from "../lib/pick";
import { Banner, ErrorBanner, Spinner, useAction, useLoad } from "../components/ui";

export function NewProjectScreen({ onCreated }: { onCreated: (id: string) => void }) {
  const catalog = useLoad(() => invoke("catalog:get"), []);
  const setup = useLoad(() => invoke("setup:status"), []);
  const settings = useLoad(() => invoke("settings:get"), []);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<VideoKind>("lesson");
  const [files, setFiles] = useState<string[]>([]);
  const [urls, setUrls] = useState("");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [style, setStyle] = useState("");
  // the defaults saved in Settings until the user picks another voice or agent for this video
  const [pickedVoice, setVoice] = useState<VoiceProfile>();
  const [pickedAgent, setAgent] = useState<AgentId>();
  // the brand kit set as default in the library, until the user picks another for this video
  const [pickedBrand, setBrand] = useState<string>();
  const brand = pickedBrand ?? settings.data?.brand;
  const create = useAction();
  const cloneReady = !!catalog.data?.voices.clone.available;
  const voice = newVideoVoice(pickedVoice, catalog.data?.voices);
  const agents = setup.data?.agents;
  const agentId = newVideoAgent(pickedAgent, agents, setup.data?.agent ?? "claude-code");
  const agent = agents?.find((a) => a.id === agentId);

  const addFiles = async () => {
    const picked = await invoke("dialog:files", "Chọn tư liệu", [...SOURCE_EXTENSIONS]);
    setFiles((f) => [...new Set([...f, ...picked])]);
  };

  const submit = () =>
    create.run(async () => {
      const req: NewProjectRequest = {
        title,
        kind,
        notes,
        style,
        voice,
        brand,
        // unknown until the agents are checked: then the default from Settings
        agent: setup.data ? agentId : undefined,
        files,
        urls: urls.split(/\s+/).filter(Boolean),
        text,
      };
      const project = await invoke("projects:create", req);
      try {
        await invoke("agent:start", project.id);
      } finally {
        // the project exists now: open it even if the agent did not start (its tab offers to start it)
        onCreated(project.id);
      }
    });

  const linkCount = urls.split(/\s+/).filter(Boolean).length;
  // a news brief tells only what its material says: it needs words to take facts from, pictures only go with them
  const needsSources = kind === "news" && !hasTextMaterial({ files, urls: urls.split(/\s+/), text });

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-header">
        <div>
          <h1>Tạo video mới</h1>
          <p className="sub">Agent đọc tư liệu, viết kịch bản và dựng storyboard. Bạn duyệt trước khi render.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          <label className="field">
            Chủ đề
            <input
              type="text"
              autoFocus
              placeholder={kind === "news" ? "Ví dụ: Android 17 beta đầu tiên mở cho Pixel" : "Ví dụ: Repository pattern trong Android"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <div className="field stack tight">
            <strong>Loại video</strong>
            <div className="choice-group">
              <Choice selected={kind === "lesson"} onSelect={() => setKind("lesson")} title="Bài giảng 16:9 kèm Short" hint="Video YouTube 3–12 phút, có chương, và một Short 9:16 riêng." />
              <Choice selected={kind === "short"} onSelect={() => setKind("short")} title="Chỉ Short 9:16" hint="45–90 giây cho Shorts, Reels, TikTok." />
              <Choice selected={kind === "news"} onSelect={() => setKind("news")} title="Bản tin 9:16" hint="45–90 giây từ bài báo hay tư liệu của bạn, mỗi con số có nguồn." />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <h2>Tư liệu</h2>
            <span className="small muted">
              {kind === "news"
                ? "Bắt buộc với bản tin: agent chỉ dùng thông tin có trong tư liệu, nên cần ít nhất một link, file .md/.txt/.pdf hoặc nội dung dán vào; ảnh đi kèm các nguồn đó."
                : "Không bắt buộc: không có tư liệu thì agent tự lên dàn ý."}
            </span>
          </div>
          <div className="stack tight">
            <div className="row">
              <button className="btn" onClick={() => void addFiles()}>
                <FilePlus2 size={15} /> Thêm file (.md, .txt, .pdf, ảnh)
              </button>
            </div>
            {files.map((f) => (
              <div key={f} className="row small">
                <span className="mono ellipsis grow">{f}</span>
                <button className="btn ghost icon-btn" aria-label="Bỏ file" onClick={() => setFiles((all) => all.filter((x) => x !== f))}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <label className="field">
            <span className="field-label">
              <Link2 size={15} style={{ alignSelf: "center" }} /> Link bài viết <span className="hint">mỗi dòng một link; app tải trang và lưu nội dung chính</span>
            </span>
            <textarea rows={2} placeholder="https://developer.android.com/topic/architecture/data-layer" value={urls} onChange={(e) => setUrls(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">
              Dán nội dung <span className="hint">ghi chú, dàn ý, đoạn code…</span>
            </span>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          <h2>Tuỳ chọn</h2>
          <div className="settings-grid">
            <label className="field">
              Brand kit
              <select value={brand ?? ""} onChange={(e) => setBrand(e.target.value)}>
                {brand !== undefined && !catalog.data?.brands.some((b) => b.id === brand) && <option value={brand}>{brand}</option>}
                {catalog.data?.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name ?? b.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Style
              <select value={style} onChange={(e) => setStyle(e.target.value)}>
                <option value="">Để agent chọn theo nội dung</option>
                {catalog.data?.styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Giọng đọc
              <select value={voice} onChange={(e) => setVoice(e.target.value as VoiceProfile)}>
                <option value="free">Giọng miễn phí (Edge TTS)</option>
                <option value="clone" disabled={!cloneReady}>
                  Giọng clone{cloneReady ? ` (${catalog.data?.voices.clone.provider})` : " (nhập key trong Cài đặt)"}
                </option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">
                Agent {agent?.installed && agent.version && <span className="hint">bản {agent.version}</span>}
              </span>
              <select value={agentId} disabled={!agents} onChange={(e) => setAgent(e.target.value as AgentId)}>
                {(agents ?? []).map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.installed}>
                    {a.name}
                    {!a.installed ? " (chưa cài)" : a.loggedIn === false ? " (chưa đăng nhập)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field-label">
              Ghi chú cho agent <span className="hint">người xem là ai, ý chính, điều cần tránh…</span>
            </span>
            <textarea
              rows={3}
              placeholder={kind === "news" ? "Nhấn mạnh điều lập trình viên Android cần làm ngay; bỏ phần tin đồn." : "Khán giả mới học Kotlin; nhấn mạnh cách viết test cho repository."}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
      </div>

      {agents && !agents.some((a) => a.installed) && (
        <Banner kind="warn">Chưa cài agent nào nên agent chưa chạy được. Xem Cài đặt để cài và đăng nhập Claude Code, Codex hoặc Devin.</Banner>
      )}
      {agent?.installed && agent.loggedIn === false && (
        <Banner kind="warn">
          {agent.name} chưa đăng nhập. Mở Terminal, chạy <code>{agent.loginCommand}</code> và đăng nhập trước khi tạo.
        </Banner>
      )}
      <ErrorBanner error={create.error} />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {create.busy && (
          <span className="row small muted">
            <Spinner size={14} /> {linkCount ? `Đang tải ${linkCount} link và tạo dự án…` : "Đang tạo dự án…"}
          </span>
        )}
        {needsSources && !create.busy && <span className="small muted">Thêm link, file .md/.txt/.pdf hoặc nội dung cho bản tin (ảnh chỉ đi kèm)</span>}
        <button className="btn primary big" disabled={!title.trim() || needsSources || create.busy || catalog.loading || setup.loading} onClick={() => void submit()}>
          <Sparkles size={16} /> Tạo và bắt đầu
        </button>
      </div>
    </div>
  );
}

function Choice({ selected, disabled, title, hint, onSelect }: { selected: boolean; disabled?: boolean; title: string; hint: string; onSelect?: () => void }) {
  return (
    <label className={`choice${selected ? " selected" : ""}${disabled ? " disabled" : ""}`}>
      <input type="radio" checked={selected} disabled={disabled} onChange={() => onSelect?.()} />
      <span className="stack tight">
        <strong>{title}</strong>
        <span className="small muted">{hint}</span>
      </span>
    </label>
  );
}
