import { useState } from "react";
import { ArrowLeft, Bot, Clapperboard, FileVideo, FolderOpen, Images } from "lucide-react";
import { AGENTS } from "../../../shared/agents";
import type { RenderJob } from "../../../shared/types";
import { invoke, useEvent } from "../lib/api";
import { AGENT_STATE_LABEL, STAGE_LABEL } from "../lib/format";
import { ErrorBanner, Spinner, useLoad } from "../components/ui";
import { agentBusy, AgentTab } from "./AgentTab";
import { RenderTab } from "./RenderTab";
import { ResultTab } from "./ResultTab";
import { StoryboardTab, type Notes, type NotesBook } from "./StoryboardTab";

export type ProjectTab = "agent" | "storyboard" | "render" | "result";

const TABS: { id: ProjectTab; label: string; icon: typeof Bot }[] = [
  { id: "agent", label: "Agent", icon: Bot },
  { id: "storyboard", label: "Storyboard", icon: Images },
  { id: "render", label: "Render", icon: Clapperboard },
  { id: "result", label: "Kết quả", icon: FileVideo },
];

export function ProjectScreen(props: { id: string; tab: ProjectTab; onTab: (tab: ProjectTab) => void; onBack: () => void; jobs: RenderJob[] }) {
  const { id, tab, onTab } = props;
  const detail = useLoad(() => invoke("projects:get", id), [id]);
  const [notes, setNotes] = useState<NotesBook>({});
  useEvent("event:projects", (e) => {
    if (!e.projectId || e.projectId === id) void detail.reload();
  });
  useEvent("event:activity", (e) => {
    if (e.projectId === id && e.type === "state") void detail.reload();
  });

  const p = detail.data;
  return (
    <div className="page">
      <div className="page-header">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <button className="btn ghost icon-btn" aria-label="Về danh sách dự án" onClick={props.onBack}>
            <ArrowLeft size={17} />
          </button>
          <div>
            <h1>{p?.title ?? " "}</h1>
            {p && (
              <div className="row wrap" style={{ marginTop: 6 }}>
                <span className="badge">{STAGE_LABEL[p.stage]}</span>
                <span className={`badge ${p.agentState === "error" ? "red" : p.agentState === "idle" ? "" : "blue"}`}>
                  {agentBusy(p.agentState) && <Spinner size={11} />}
                  {AGENT_STATE_LABEL[p.agentState]}
                </span>
                <span className="badge" title="Agent của video này">
                  <Bot size={11} /> {AGENTS[p.agent]?.name ?? p.agent}
                </span>
                <span className="small faint mono ellipsis">{p.dir}</span>
              </div>
            )}
          </div>
        </div>
        <button className="btn" onClick={() => void invoke("projects:reveal", id)}>
          <FolderOpen size={15} /> Mở thư mục
        </button>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${t.id === tab ? " active" : ""}`} onClick={() => onTab(t.id)}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner error={detail.error} />
      {!p ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : tab === "agent" ? (
        <AgentTab projectId={id} canStart={p.stage === "new"} />
      ) : tab === "storyboard" ? (
        <StoryboardTab
          project={p}
          notes={notes}
          setNotes={(key: string, n: Notes) => setNotes((all) => ({ ...all, [key]: n }))}
          onSent={() => onTab("agent")}
          onApprove={() => onTab("render")}
          agentBusy={agentBusy(p.agentState)}
        />
      ) : tab === "render" ? (
        <RenderTab project={p} jobs={props.jobs} onResults={() => onTab("result")} />
      ) : (
        <ResultTab project={p} />
      )}
    </div>
  );
}
