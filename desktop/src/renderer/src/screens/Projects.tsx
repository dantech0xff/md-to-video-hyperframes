import { Clapperboard, FolderOpen, Plus } from "lucide-react";
import type { ProjectSummary } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke, useEvent } from "../lib/api";
import { AGENT_STATE_LABEL, ago, STAGE_LABEL } from "../lib/format";
import { ErrorBanner, Spinner, useLoad } from "../components/ui";

const STAGE_COLOR = { new: "", writing: "blue", review: "amber", rendered: "green" } as const;

export function ProjectsScreen({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const projects = useLoad(() => invoke("projects:list"), []);
  useEvent("event:projects", () => void projects.reload());
  useEvent("event:activity", (e) => {
    if (e.type === "state") void projects.reload();
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
      <ErrorBanner error={projects.error} />
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
            <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
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
          {project.kind === "lesson" ? "Bài giảng 16:9 + Short" : "Short 9:16"} · {ago(project.updatedAt)}
        </span>
      </div>
    </button>
  );
}
