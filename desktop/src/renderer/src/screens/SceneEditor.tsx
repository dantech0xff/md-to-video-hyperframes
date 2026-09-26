/**
 * Editing one scene, chapter card or the outro in the storyboard review,
 * without the agent (design doc §12, 2.3): the fields come from the engine's
 * schema, the engine checks the whole script before it is saved, and the app
 * then builds the storyboard again and tells the agent on its next message.
 */
import { useEffect, useState } from "react";
import { RefreshCw, Save, X } from "lucide-react";
import type { ProjectDetail, SavePartResult, VideoTarget } from "../../../shared/types";
import { invoke } from "../lib/api";
import { Banner, ErrorBanner, Spinner, useAction, useLoad } from "../components/ui";
import { SchemaForm } from "../components/SchemaForm";

const KIND_LABEL = { scene: "cảnh", chapter: "thẻ chương", outro: "outro" } as const;

export function SceneEditor(props: {
  project: ProjectDetail;
  video: VideoTarget["id"];
  sceneKey: string;
  agentBusy: boolean;
  onClose: () => void;
  /** saved; `changed` when the script changed and its storyboard is being built again */
  onSaved: (changed: boolean) => void;
}) {
  const { project, video, sceneKey } = props;
  const part = useLoad(() => invoke("script:part", project.id, video, sceneKey), [project.id, video, sceneKey]);
  const [value, setValue] = useState<Record<string, unknown>>();
  const [refused, setRefused] = useState<Extract<SavePartResult, { ok: false }>>();
  const save = useAction();

  // a fresh read starts over from what the script has
  useEffect(() => {
    setValue(part.data?.value);
    setRefused(undefined);
  }, [part.data]);

  const data = part.data;
  const dirty = !!data && !!value && JSON.stringify(value) !== JSON.stringify(data.value);
  const submit = () =>
    save.run(async () => {
      if (!data || !value) return;
      const res = await invoke("script:save-part", project.id, video, { key: sceneKey, version: data.version, value });
      if (res.ok) props.onSaved(res.changed);
      else setRefused(res);
    });

  const whole = refused?.errors.filter((e) => !e.path) ?? [];
  return (
    <div className="scene-editor">
      <div className="row wrap">
        <strong>
          Sửa {data ? KIND_LABEL[data.kind] : ""} <span className="mono">{sceneKey}</span>
        </strong>
        {data?.kind === "scene" && <span className="badge">{data.type}</span>}
        <span className="grow" />
        <button type="button" className="btn ghost icon-btn" aria-label="Đóng" onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>

      <ErrorBanner error={part.error} />
      {part.loading && !data && (
        <div className="empty">
          <Spinner />
        </div>
      )}
      {refused?.conflict && (
        <Banner kind="warn">
          <div className="row wrap">
            <span className="grow">Kịch bản vừa đổi ở nơi khác (agent, hoặc một trình soạn thảo) nên chưa lưu. Tải lại để sửa trên bản mới; những gì bạn vừa nhập sẽ mất.</span>
            <button type="button" className="btn small" onClick={() => void part.reload()}>
              <RefreshCw size={13} /> Tải lại
            </button>
          </div>
        </Banner>
      )}
      {refused && !refused.conflict && (
        <Banner kind="error">
          Chưa lưu: kịch bản sẽ không hợp lệ. Sửa các ô báo đỏ bên dưới.
          {[...whole, ...refused.others].map((e, i) => (
            <div key={i} className="small">
              {e.path ? <span className="mono">{e.path}: </span> : null}
              {e.message}
            </div>
          ))}
        </Banner>
      )}

      {data && value && (
        <SchemaForm schema={data.schema} value={value} onChange={setValue} advanced={data.advanced} problems={refused?.errors ?? []} disabled={save.busy} />
      )}

      <div className="row wrap">
        <button type="button" className="btn primary" disabled={!dirty || save.busy || props.agentBusy} onClick={() => void submit()}>
          {save.busy ? <Spinner size={14} /> : <Save size={14} />} Lưu và dựng lại storyboard
        </button>
        <button type="button" className="btn" onClick={props.onClose}>
          Huỷ
        </button>
        <span className="small muted">
          {props.agentBusy ? "Agent đang làm việc: lưu được khi agent xong lượt." : "Agent sẽ được báo về thay đổi này ở tin nhắn sau."}
        </span>
      </div>
      <ErrorBanner error={save.error} />
    </div>
  );
}
