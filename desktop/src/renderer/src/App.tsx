import { useEffect, useState } from "react";
import { Clapperboard, FolderKanban, Library, Plus, Settings } from "lucide-react";
import type { RenderJob } from "../../shared/types";
import { invoke, useEvent } from "./lib/api";
import { FORMAT_LABEL } from "./lib/format";
import { ErrorBanner, Progress, Spinner, useLoad } from "./components/ui";
import { LibraryScreen } from "./screens/Library";
import { NewProjectScreen } from "./screens/NewProject";
import { ProjectScreen, type ProjectTab } from "./screens/Project";
import { ProjectsScreen } from "./screens/Projects";
import { SettingsScreen } from "./screens/Settings";
import { SetupScreen } from "./screens/Setup";

type Route = { name: "projects" } | { name: "new" } | { name: "library" } | { name: "settings" } | { name: "project"; id: string; tab: ProjectTab };

export function App() {
  const setup = useLoad(() => invoke("setup:status"), []);
  const [route, setRoute] = useState<Route>({ name: "projects" });
  const [jobs, setJobs] = useState<RenderJob[]>([]);

  useEffect(() => {
    void invoke("render:list").then(setJobs);
  }, []);
  useEvent("event:render", (job) => setJobs((all) => [...all.filter((j) => j.id !== job.id), job]));

  if (!setup.data) {
    return (
      <div className="empty" style={{ height: "100%", justifyContent: "center" }}>
        {setup.error ? <ErrorBanner error={setup.error} /> : <Spinner size={22} />}
      </div>
    );
  }
  if (!setup.data.done) return <SetupScreen initial={setup.data} onDone={() => void setup.reload()} />;

  const open = (id: string, tab: ProjectTab = "agent") => setRoute({ name: "project", id, tab });
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Clapperboard size={15} />
          </div>
          Get Frames
        </div>
        <NavItem active={route.name === "projects" || route.name === "project"} icon={<FolderKanban size={17} />} label="Dự án" onClick={() => setRoute({ name: "projects" })} />
        <NavItem active={route.name === "new"} icon={<Plus size={17} />} label="Tạo video" onClick={() => setRoute({ name: "new" })} />
        <NavItem active={route.name === "library"} icon={<Library size={17} />} label="Thư viện" onClick={() => setRoute({ name: "library" })} />
        <NavItem active={route.name === "settings"} icon={<Settings size={17} />} label="Cài đặt" onClick={() => setRoute({ name: "settings" })} />
        <div className="sidebar-footer">
          {active.map((job) => (
            <button key={job.id} className="queue-mini nav-item" onClick={() => open(job.projectId, "render")}>
              <span className="row" style={{ width: "100%" }}>
                <Spinner size={12} />
                <span className="ellipsis grow">{job.title}</span>
              </span>
              <Progress percent={job.percent} indeterminate={job.status === "queued"} />
              <span className="faint">{job.status === "queued" ? "Đang chờ" : `${job.format ? FORMAT_LABEL[job.format] : ""} ${job.percent}%`}</span>
            </button>
          ))}
        </div>
      </nav>
      <main className="main">
        {route.name === "projects" && <ProjectsScreen onOpen={(id) => open(id)} onNew={() => setRoute({ name: "new" })} />}
        {route.name === "new" && <NewProjectScreen onCreated={(id) => open(id)} />}
        {route.name === "library" && <LibraryScreen />}
        {route.name === "settings" && <SettingsScreen />}
        {route.name === "project" && (
          <ProjectScreen
            key={route.id}
            id={route.id}
            tab={route.tab}
            jobs={jobs}
            onTab={(tab) => setRoute({ ...route, tab })}
            onBack={() => setRoute({ name: "projects" })}
          />
        )}
      </main>
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`nav-item${active ? " active" : ""}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
