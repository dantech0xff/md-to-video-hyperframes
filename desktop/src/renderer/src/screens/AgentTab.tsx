/** What the agent is doing (design doc §3, step 3): messages, tool calls, plan, and the questions it asks. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Brain,
  CircleCheck,
  CircleDashed,
  CircleX,
  FilePen,
  FileText,
  Globe,
  ListChecks,
  Play,
  Search,
  Send,
  ShieldQuestion,
  Square,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ActivityEntry, ActivityEvent, AgentState } from "../../../shared/types";
import { invoke, useEvent } from "../lib/api";
import { applyActivity, catchUp, type ActivityView } from "../lib/activity";
import { Markdown } from "../components/Markdown";
import { Banner, ErrorBanner, Spinner, useAction } from "../components/ui";

export function AgentTab({ projectId, canStart }: { projectId: string; canStart: boolean }) {
  const [view, setView] = useState<ActivityView>({ entries: [], state: "idle" });
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const action = useAction();
  const feed = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  /** events that come while the saved activity loads; null once it is shown */
  const early = useRef<ActivityEvent[] | null>([]);

  useEffect(() => {
    setLoaded(false);
    early.current = [];
    let current = true;
    void invoke("agent:activity", projectId).then((v) => {
      if (!current) return;
      setView(catchUp(v, early.current ?? []));
      early.current = null;
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [projectId]);
  useEvent("event:activity", (e) => {
    if (e.projectId !== projectId) return;
    if (early.current) early.current.push(e);
    else setView((v) => applyActivity(v, e));
  });

  // follow new entries unless the user scrolled up to read
  useLayoutEffect(() => {
    const el = feed.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [view.entries]);

  const busy = view.state === "working" || view.state === "waiting";
  const send = () =>
    action.run(async () => {
      const text = draft.trim();
      if (!text) return;
      await invoke("agent:send", projectId, text);
      setDraft("");
      stick.current = true;
    });

  return (
    <div className="card agent-layout">
      <div
        className="feed"
        ref={feed}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {loaded && view.entries.length === 0 && (
          <div className="empty">
            <Brain size={32} />
            <h3>Agent chưa bắt đầu</h3>
            <p>Agent sẽ đọc tư liệu, viết kịch bản, tự kiểm tra bằng Studio tools và dựng storyboard.</p>
            {canStart && (
              <button className="btn primary" disabled={action.busy} onClick={() => void action.run(() => invoke("agent:start", projectId))}>
                <Play size={15} /> Bắt đầu
              </button>
            )}
          </div>
        )}
        {view.entries.map((entry) => (
          <Entry key={entry.id} entry={entry} projectId={projectId} />
        ))}
        {busy && (
          <div className="row small muted">
            <Spinner size={14} /> {view.state === "waiting" ? "Agent đang chờ bạn trả lời" : "Agent đang làm việc…"}
          </div>
        )}
      </div>
      {canStart && loaded && view.entries.length > 0 && !busy && (
        <div style={{ padding: "0 14px 10px" }}>
          <Banner kind="warn">
            <div className="row">
              <span className="grow">Agent chưa bắt đầu được. Sửa lỗi ở trên (ví dụ đăng nhập agent) rồi gửi lại yêu cầu ban đầu.</span>
              <button className="btn small primary" disabled={action.busy} onClick={() => void action.run(() => invoke("agent:start", projectId))}>
                <Play size={13} /> Bắt đầu lại
              </button>
            </div>
          </Banner>
        </div>
      )}
      <ErrorBanner error={action.error} />
      <div className="composer">
        <textarea
          className="grow"
          placeholder={busy ? "Chờ agent xong lượt này, hoặc bấm Dừng" : "Nhắn cho agent… (⌘/Ctrl + Enter để gửi)"}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button className="btn danger" onClick={() => void action.run(() => invoke("agent:cancel", projectId))}>
            <Square size={14} /> Dừng
          </button>
        ) : (
          <button className="btn primary" disabled={!draft.trim() || action.busy} onClick={() => void send()}>
            <Send size={14} /> Gửi
          </button>
        )}
      </div>
    </div>
  );
}

const TOOL_ICON: Record<string, typeof Wrench> = {
  read: FileText,
  edit: FilePen,
  delete: FilePen,
  move: FilePen,
  search: Search,
  execute: Terminal,
  fetch: Globe,
  think: Brain,
};

function Entry({ entry, projectId }: { entry: ActivityEntry; projectId: string }) {
  switch (entry.kind) {
    case "user":
      return <UserEntry text={entry.text} />;
    case "message":
      return (
        <div className="entry-message">
          <Markdown text={entry.text} />
        </div>
      );
    case "thought":
      return <ThoughtEntry text={entry.text} />;
    case "tool": {
      const Icon = TOOL_ICON[entry.toolKind ?? ""] ?? Wrench;
      return (
        <div className="entry-tool">
          <Icon size={15} style={{ marginTop: 2, flex: "none" }} />
          <div className="grow stack tight" style={{ gap: 2 }}>
            <span className="title">{entry.title}</span>
            {entry.files && entry.files.length > 0 && !entry.files.every((f) => entry.title.includes(f)) && <span className="small faint mono">{entry.files.join(", ")}</span>}
          </div>
          <ToolStatus status={entry.status} />
        </div>
      );
    }
    case "plan":
      return (
        <div className="entry-plan">
          <span className="row small muted">
            <ListChecks size={14} /> Kế hoạch
          </span>
          {entry.steps.map((s, i) => (
            <span key={i} className="row small">
              {s.status === "completed" ? <CircleCheck size={14} color="var(--accent)" /> : s.status === "in_progress" ? <Spinner size={14} /> : <CircleDashed size={14} className="faint" />}
              <span style={{ textDecoration: s.status === "completed" ? "line-through" : undefined }}>{s.title}</span>
            </span>
          ))}
        </div>
      );
    case "permission":
      return <PermissionEntry entry={entry} projectId={projectId} />;
    case "notice":
      return <Banner kind={entry.level === "error" ? "error" : entry.level === "warning" ? "warn" : "info"}>{entry.text}</Banner>;
    case "end":
      return <div className="entry-end">{END_LABEL[entry.reason]}{entry.error && entry.reason !== "done" ? `: ${entry.error}` : ""}</div>;
  }
}

const END_LABEL = { done: "Xong lượt", cancelled: "Đã dừng", error: "Lỗi", refusal: "Agent từ chối yêu cầu", limit: "Chạm giới hạn của agent" } as const;

function ToolStatus({ status }: { status: "pending" | "running" | "done" | "failed" }) {
  if (status === "done") return <CircleCheck size={15} color="var(--accent)" />;
  if (status === "failed") return <CircleX size={15} color="var(--danger)" />;
  return <Spinner size={15} />;
}

function UserEntry({ text }: { text: string }) {
  const long = text.length > 420 || text.split("\n").length > 7;
  const [open, setOpen] = useState(!long);
  return (
    <div className={`entry-user${open ? "" : " collapsed"}`}>
      <div className="pre-wrap">{text}</div>
      {long && (
        <button className="btn ghost small" style={{ paddingLeft: 0 }} onClick={() => setOpen(!open)}>
          {open ? "Thu gọn" : "Xem đầy đủ"}
        </button>
      )}
    </div>
  );
}

function ThoughtEntry({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="entry-thought" onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
      <Brain size={12} /> {open ? text : `${text.slice(0, 140)}${text.length > 140 ? "…" : ""}`}
    </div>
  );
}

function PermissionEntry({ entry, projectId }: { entry: Extract<ActivityEntry, { kind: "permission" }>; projectId: string }) {
  const answered = entry.answer !== undefined;
  const chosen = entry.options.find((o) => o.id === entry.answer);
  return (
    <div className="entry-permission">
      <span className="row">
        <ShieldQuestion size={16} color="var(--warn)" />
        <strong>Agent xin phép: {entry.title}</strong>
      </span>
      {entry.detail && <pre>{entry.detail}</pre>}
      {answered ? (
        <span className="small muted">{chosen ? `Bạn đã chọn: ${chosen.name}` : "Đã huỷ"}</span>
      ) : (
        <div className="row wrap">
          {entry.options.map((o) => (
            <button
              key={o.id}
              className={`btn small${o.kind.startsWith("allow") ? (o.kind === "allow_once" ? " primary" : "") : " danger"}`}
              onClick={() => void invoke("agent:answer", projectId, entry.id, o.id)}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function agentBusy(state: AgentState): boolean {
  return state === "working" || state === "waiting";
}
