/**
 * First run (design doc §9): Chrome headless, FFmpeg, the agents, the projects
 * folder and the voice. The same checks show in Settings.
 */
import { useState } from "react";
import { Bot, Check, Clapperboard, Film, FolderOpen, Globe, Mic, RefreshCw, TriangleAlert } from "lucide-react";
import { AGENTS } from "../../../shared/agents";
import type { AgentId, AgentStatus, SetupStatus } from "../../../shared/types";
import { invoke, useEvent } from "../lib/api";
import { Banner, ErrorBanner, Progress, Spinner, useAction } from "../components/ui";

const isMac = navigator.userAgent.includes("Mac OS");

export function ToolChecks({ status, onChange }: { status: SetupStatus; onChange: (s: SetupStatus) => void }) {
  const [chromePercent, setChromePercent] = useState<number | undefined>();
  const download = useAction();
  const check = useAction();
  useEvent("event:setup", (p) => setChromePercent(p.percent));

  const refresh = () => check.run(async () => onChange(await invoke("setup:status")));
  const pickFfmpeg = () =>
    check.run(async () => {
      const [file] = await invoke("dialog:files", "Chọn file ffmpeg", []);
      if (!file) return;
      await invoke("settings:save", { settings: { paths: { ffmpeg: file } } });
      onChange(await invoke("setup:status"));
    });
  const pickProgram = (id: AgentId) =>
    check.run(async () => {
      const { program } = AGENTS[id];
      const [file] = await invoke("dialog:files", `Chọn file ${program}`, []);
      if (!file) return;
      await invoke("settings:save", { settings: { paths: { [program]: file } } });
      onChange(await invoke("setup:status"));
    });
  const makeDefault = (id: AgentId) =>
    check.run(async () => {
      await invoke("settings:save", { settings: { agent: id } });
      onChange(await invoke("setup:status"));
    });

  return (
    <div className="card">
      <div className="step">
        <StepIcon ok={status.chrome.ok}>
          <Globe size={17} />
        </StepIcon>
        <div className="stack tight">
          <h3>Chrome headless</h3>
          <p className="muted">Để dựng storyboard và render. App tải bản {status.chrome.build || "HyperFrames cần"} (khoảng 100 MB) từ máy chủ của Google vào thư mục dữ liệu của app.</p>
          {status.chrome.ok ? (
            <p className="small faint mono ellipsis">{status.chrome.path}</p>
          ) : download.busy ? (
            <div className="stack tight">
              <Progress percent={chromePercent} indeterminate={chromePercent === undefined} />
              <span className="small muted">Đang tải… {chromePercent ?? 0}%</span>
            </div>
          ) : (
            <div>
              <button className="btn primary" onClick={() => download.run(async () => onChange(await invoke("setup:install-chrome")))}>
                Tải Chrome headless
              </button>
            </div>
          )}
          <ErrorBanner error={download.error} />
        </div>
      </div>

      <div className="step">
        <StepIcon ok={status.ffmpeg.ok}>
          <Film size={17} />
        </StepIcon>
        <div className="stack tight">
          <h3>FFmpeg</h3>
          {status.ffmpeg.ok ? (
            <p className="muted">
              Bản {status.ffmpeg.version} <span className="mono small faint">{status.ffmpeg.path}</span>
            </p>
          ) : (
            <>
              <p className="muted">
                Chưa tìm thấy FFmpeg{status.ffmpeg.error ? ` (${status.ffmpeg.error})` : ""}. Cài bằng{" "}
                {isMac ? <code>brew install ffmpeg</code> : <code>winget install Gyan.FFmpeg</code>} rồi bấm Kiểm tra lại, hoặc chọn file ffmpeg.
              </p>
              <div className="row">
                <button className="btn" onClick={() => void pickFfmpeg()}>
                  <FolderOpen size={15} /> Chọn file ffmpeg…
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="step">
        <StepIcon ok={status.agents.some((a) => a.installed && a.loggedIn !== false)}>
          <Bot size={17} />
        </StepIcon>
        <div className="stack">
          <div className="stack tight">
            <h3>AI agent</h3>
            <p className="muted">Agent viết kịch bản bằng tài khoản của bạn. Cần ít nhất một trong ba; mỗi video chọn được agent riêng, mặc định là agent đánh dấu bên dưới.</p>
          </div>
          {status.agents.map((agent) => (
            <AgentCheck
              key={agent.id}
              agent={agent}
              isDefault={agent.id === status.agent}
              busy={check.busy}
              onPick={() => void pickProgram(agent.id)}
              onDefault={() => void makeDefault(agent.id)}
            />
          ))}
        </div>
      </div>

      <div className="step">
        <span />
        <div className="row">
          <button className="btn" disabled={check.busy} onClick={() => void refresh()}>
            {check.busy ? <Spinner size={14} /> : <RefreshCw size={14} />} Kiểm tra lại
          </button>
          <ErrorBanner error={check.error} />
        </div>
      </div>
    </div>
  );
}

function AgentCheck(props: { agent: AgentStatus; isDefault: boolean; busy: boolean; onPick: () => void; onDefault: () => void }) {
  const { agent } = props;
  return (
    <div className="agent-check stack tight">
      <div className="row wrap">
        <strong>{agent.name}</strong>
        {!agent.installed ? (
          <span className="badge">chưa cài</span>
        ) : agent.loggedIn === false ? (
          <span className="badge amber">chưa đăng nhập</span>
        ) : (
          <span className="badge green">{agent.loggedIn ? "sẵn sàng" : "đã cài"}</span>
        )}
        {props.isDefault ? (
          <span className="badge blue">mặc định</span>
        ) : (
          agent.installed && (
            <button className="btn small ghost" disabled={props.busy} onClick={props.onDefault}>
              Đặt làm mặc định
            </button>
          )
        )}
      </div>
      {agent.installed ? (
        <>
          <p className="small muted">
            Bản {agent.version} <span className="mono faint">{agent.path}</span>
          </p>
          {agent.loggedIn === true && agent.account && <p className="small">Đăng nhập: {agent.account}</p>}
          {agent.loggedIn === false && (
            <Banner kind="warn">
              Chưa đăng nhập. Mở Terminal, chạy <code>{agent.loginCommand}</code>, đăng nhập rồi bấm Kiểm tra lại.
            </Banner>
          )}
          {agent.loggedIn === null && <p className="small muted">Chưa rõ trạng thái đăng nhập; phiên đầu tiên sẽ cho biết.</p>}
        </>
      ) : (
        <>
          <p className="small muted">Chưa tìm thấy trên máy{agent.error ? ` (${agent.error})` : ""}.</p>
          <div className="row">
            <button className="btn small" onClick={() => void invoke("app:open-external", agent.installUrl)}>
              Hướng dẫn cài đặt
            </button>
            <button className="btn small ghost" disabled={props.busy} onClick={props.onPick}>
              <FolderOpen size={13} /> Chọn file {AGENTS[agent.id].program}…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StepIcon({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <div className={`step-icon ${ok ? "ok" : "bad"}`}>{ok ? <Check size={17} /> : children}</div>;
}

export function SetupScreen({ initial, onDone }: { initial: SetupStatus; onDone: () => void }) {
  const [status, setStatus] = useState(initial);
  const finish = useAction();
  const ready = status.chrome.ok && status.ffmpeg.ok;
  const agentReady = status.agents.some((a) => a.installed);

  const pickFolder = () =>
    finish.run(async () => {
      const dir = await invoke("dialog:folder", "Thư mục chứa dự án video");
      if (!dir) return;
      await invoke("settings:save", { settings: { projectsDir: dir } });
      setStatus(await invoke("setup:status"));
    });

  return (
    <div className="setup">
      <div className="page">
        <div className="stack tight" style={{ marginTop: 20 }}>
          <div className="row">
            <div className="brand-mark">
              <Clapperboard size={16} />
            </div>
            <h1>Chào mừng đến Get Frames</h1>
          </div>
          <p className="muted">
            Get Frames nhờ AI agent trên máy bạn (Claude Code, Codex hoặc Devin) viết kịch bản bài giảng, rồi dựng storyboard để bạn duyệt và render video 16:9 và 9:16. Cần chuẩn bị vài thứ:
          </p>
        </div>

        <ToolChecks status={status} onChange={setStatus} />

        <div className="card">
          <div className="step">
            <div className="step-icon ok">
              <FolderOpen size={17} />
            </div>
            <div className="stack tight">
              <h3>Thư mục dự án</h3>
              <p className="muted">Mỗi video là một thư mục con ở đây: tư liệu, kịch bản, storyboard và video.</p>
              <div className="row">
                <span className="mono small ellipsis grow">{status.projectsDir}</span>
                <button className="btn small" onClick={() => void pickFolder()}>
                  Đổi…
                </button>
              </div>
            </div>
          </div>
          <div className="step">
            <div className="step-icon ok">
              <Mic size={17} />
            </div>
            <div className="stack tight">
              <h3>Giọng đọc</h3>
              <p className="muted">Mặc định dùng giọng miễn phí Edge TTS, không cần key. Muốn dùng giọng clone (ElevenLabs, LucyLab) thì nhập key sau trong Cài đặt.</p>
            </div>
          </div>
        </div>

        {!agentReady && ready && <Banner kind="warn">Chưa có agent nào: bạn vẫn vào app được, nhưng cần cài Claude Code, Codex hoặc Devin trước khi tạo video.</Banner>}
        <ErrorBanner error={finish.error} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {!ready && (
            <span className="muted small row">
              <TriangleAlert size={14} /> Cần Chrome headless và FFmpeg
            </span>
          )}
          <button
            className="btn primary big"
            disabled={!ready || finish.busy}
            onClick={() =>
              void finish.run(async () => {
                await invoke("setup:finish");
                onDone();
              })
            }
          >
            Bắt đầu dùng
          </button>
        </div>
      </div>
    </div>
  );
}
