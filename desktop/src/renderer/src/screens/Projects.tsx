import { Clapperboard, FolderOpen, Plus, Trash2 } from "lucide-react";
import { AGENTS } from "../../../shared/agents";
import type { ProjectSummary } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke, useEvent } from "../lib/api";
import { AGENT_STATE_LABEL, ago, KIND_LABEL, STAGE_LABEL } from "../lib/format";
import { ErrorBanner, Spinner, useAction, useLoad } from "../components/ui";

const STAGE_COLOR = { new: "", writing: "blue", review: "amber", rendered: "green" } as const;

export function ProjectsScreen({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const projects = useLoad(() => invoke("projects:list"), []);
  useEvent("event:projects", () => void projects.reload());
  useEvent("event:activity", (e) => {
    if (e.type === "state") void projects.reload();
  });

  const del = useAction();
  const remove = (p: ProjectSummary) =>
    del.run(async () => {
      if (!window.confirm(`Xoá dự án "${p.title}"?\n\nThư mục của nó chuyển vào Thùng rác — có thể khôi phục.`)) return;
      await invoke("projects:delete", p.id);
    });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dự án</h1>
          <p className="sub">Mỗi dự án là một video: agent viết kịch bản, bạn duyệt storyboard rồi render.</p>
        </div>
        <button className="btn primary" onClick={onNew}>
          <Plus size={16} /> Tạo video mới
        </button>
      </div>
      <ErrorBanner error={projects.error ?? del.error} />
      {projects.loading && !projects.data ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : !projects.data?.length ? (
        <div className="card">
          <div className="empty">
            <Clapperboard size={34} />
            <h3>Chưa có dự án nào</h3>
            <p>Tạo video đầu tiên: nhập chủ đề, thêm tư liệu (file hoặc link), agent sẽ viết kịch bản.</p>
            <button className="btn primary" onClick={onNew}>
              <Plus size={16} /> Tạo video mới
            </button>
          </div>
        </div>
      ) : (
        <div className="project-grid">
          {projects.data.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p.id)} onDelete={() => remove(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen, onDelete }: { project: ProjectSummary; onOpen: () => void; onDelete: () => void }) {
  const agentWorking = project.agentState === "working" || project.agentState === "waiting";
  return (
    <div className="project-card-wrap">
      <button className="card project-card" onClick={onOpen}>
        <div className="thumb">{project.thumbnail ? <img src={mediaUrl(project.thumbnail, project.updatedAt)} alt="" /> : <FolderOpen size={28} />}</div>
        <div className="card-body">
          <h3 className="ellipsis">{project.title}</h3>
          <div className="row wrap">
            <span className={`badge ${STAGE_COLOR[project.stage]}`}>{STAGE_LABEL[project.stage]}</span>
            {project.agentState !== "idle" && (
              <span className={`badge ${project.agentState === "error" ? "red" : project.agentState === "waiting" ? "amber" : "blue"}`}>
                {project.agentState === "working" && <Spinner size={11} />}
                {AGENT_STATE_LABEL[project.agentState]}
              </span>
            )}
          </div>
          <span className="small faint">
            {KIND_LABEL[project.kind] ?? project.kind} · {AGENTS[project.agent]?.name ?? project.agent} · {ago(project.updatedAt)}
          </span>
        </div>
      </button>
      <button
        type="button"
        className="btn icon-btn danger project-card-del"
        disabled={agentWorking}
        title={agentWorking ? "Agent đang làm việc: xoá khi agent xong lượt" : "Xoá dự án này (thư mục chuyển vào Thùng rác)"}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
