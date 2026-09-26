/** The editor of a brand kit of the user's: its words, logos, wordmark, call to action, style and mascot. */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, Plus, Save, X } from "lucide-react";
import { MASCOT_POSES, type BrandImageField, type BrandKitFile, type MascotPose } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke } from "../lib/api";
import { brandDraft, brandValue, issuesByField, POSE_LABEL, type BrandDraft } from "../lib/library";
import { Banner, ErrorBanner, Spinner, useAction, useLoad } from "../components/ui";
import { BrandPreview } from "./Library";

const LOGOS: { field: "onDark" | "onLight" | "square"; label: string; hint: string }[] = [
  { field: "onDark", label: "Logo trên nền tối", hint: "PNG nền trong suốt, chữ sáng" },
  { field: "onLight", label: "Logo trên nền sáng", hint: "PNG nền trong suốt, chữ tối" },
  { field: "square", label: "Logo vuông", hint: "PNG vuông, cho ảnh đại diện" },
];

export function BrandEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const kit = useLoad(() => invoke("library:brand", id), [id]);
  const catalog = useLoad(() => invoke("catalog:get"), []);
  // kept here: the form starts again from the kit as saved (its images' new names)
  const [saved, setSaved] = useState(false);
  if (kit.error) return <ErrorBanner error={kit.error} />;
  if (!kit.data || !catalog.data) return <Spinner />;
  return (
    <Form
      key={JSON.stringify(kit.data.value)}
      kit={kit.data}
      styles={catalog.data.styles}
      saved={saved}
      onEdited={() => setSaved(false)}
      onSaved={() => {
        setSaved(true);
        void kit.reload();
      }}
      onDone={onDone}
    />
  );
}

function Form(props: { kit: BrandKitFile; styles: { id: string; name: string }[]; saved: boolean; onEdited: () => void; onSaved: () => void; onDone: () => void }) {
  const { kit, styles, saved, onEdited, onSaved, onDone } = props;
  const [draft, setDraft] = useState<BrandDraft>(() => brandDraft(kit.value));
  const [images, setImages] = useState<Partial<Record<BrandImageField, string>>>({});
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const save = useAction();
  // an edit after a save: no longer saved
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else onEdited();
  }, [draft, images]);

  const set = <K extends keyof BrandDraft>(key: K, value: BrandDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const pick = async (field: BrandImageField, extensions: string[]) => {
    const [file] = await invoke("dialog:files", "Chọn ảnh", extensions);
    if (file) setImages((all) => ({ ...all, [field]: file }));
  };
  const clearImage = (field: BrandImageField) =>
    setImages((all) => {
      const next = { ...all };
      delete next[field];
      return next;
    });
  const errors = (path: string) => issues[path]?.map((m) => <span key={m} className="sf-error">{m}</span>);
  const imageMascot = draft.mascot.kind === "image" ? draft.mascot : undefined;

  const submit = () =>
    void save.run(async () => {
      const res = await invoke("library:save-brand", kit.id, { value: brandValue(kit.value, draft), images });
      setIssues(issuesByField(res.issues));
      if (res.ok) onSaved();
    });

  const imageSlot = (field: BrandImageField, current: string | undefined, extensions: string[], onRemove: () => void) => (
    <div className="image-slot">
      <div className="image-slot-preview">
        {images[field] ? (
          <span className="small muted">Sẽ dùng: {images[field]!.split(/[\\/]/).pop()}</span>
        ) : current ? (
          <img src={mediaUrl(`${kit.dir}/${current}`)} alt="" />
        ) : (
          <span className="small faint">Chưa có</span>
        )}
      </div>
      <div className="row">
        <button className="btn small" onClick={() => void pick(field, extensions)}>
          <ImagePlus size={14} /> Chọn ảnh
        </button>
        {(images[field] || current) && (
          <button className="btn small" title="Bỏ ảnh này" onClick={() => (images[field] ? clearImage(field) : onRemove())}>
            <X size={14} />
          </button>
        )}
      </div>
      {errors(field)}
    </div>
  );

  return (
    <div className="stack">
      <div className="page-header">
        <div className="row">
          <button className="btn small" onClick={onDone} title="Về thư viện">
            <ArrowLeft size={15} />
          </button>
          <div>
            <h1>{draft.name || kit.id}</h1>
            <p className="sub mono">{kit.id}</p>
          </div>
        </div>
        <button className="btn primary" disabled={save.busy || !draft.name.trim()} onClick={submit}>
          {save.busy ? <Spinner size={14} /> : <Save size={15} />} Lưu
        </button>
      </div>
      <ErrorBanner error={save.error} />
      {saved && <Banner>Đã lưu. Video dựng từ giờ dùng brand kit này như bạn vừa sửa.</Banner>}
      {issues[""] && <Banner kind="error">{issues[""].join("; ")}</Banner>}

      <div className="card">
        <div className="card-body stack">
          <div className="card-title">
            <h3>Tên và lời giới thiệu</h3>
            <BrandPreview kit={{ name: draft.name, wordmark: draft.wordmark.filter((p) => p.text.trim()), logo: {} }} />
          </div>
          <div className="row wrap">
            <Text label="Tên brand" value={draft.name} max={60} onChange={(v) => set("name", v)} errors={errors("name")} />
            <Text label="Tên ngắn" hint="không bắt buộc" value={draft.shortName} max={40} onChange={(v) => set("shortName", v)} errors={errors("shortName")} />
          </div>
          <Text label="Tagline" hint="hiện ở intro" value={draft.tagline} max={120} onChange={(v) => set("tagline", v)} errors={errors("tagline")} />
          <div className="row wrap">
            <Text label="Website" value={draft.website} max={80} onChange={(v) => set("website", v)} errors={errors("website")} />
            <Text label="Handle" hint="ví dụ @kenh" value={draft.handle} max={60} onChange={(v) => set("handle", v)} errors={errors("handle")} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          <h3>Logo</h3>
          <div className="stack tight">
            <span className="field-label">
              <strong>Chữ thay logo (wordmark)</strong>
              <span className="hint muted small">Khi có, video hiện chữ này bằng font của style thay cho logo PNG. Tối đa 4 phần, mỗi phần một màu.</span>
            </span>
            {draft.wordmark.map((part, i) => (
              <div className="row" key={i}>
                <input type="text" value={part.text} maxLength={30} placeholder="Chữ" onChange={(e) => set("wordmark", draft.wordmark.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)))} />
                <label className="row small muted">
                  <input type="checkbox" checked={!!part.color} onChange={(e) => set("wordmark", draft.wordmark.map((p, j) => (j === i ? (e.target.checked ? { ...p, color: "#47c038" } : { text: p.text }) : p)))} />
                  Màu riêng
                </label>
                {part.color && <input type="color" value={part.color} onChange={(e) => set("wordmark", draft.wordmark.map((p, j) => (j === i ? { ...p, color: e.target.value } : p)))} />}
                <button className="btn small" title="Bỏ phần này" onClick={() => set("wordmark", draft.wordmark.filter((_, j) => j !== i))}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {draft.wordmark.length < 4 && (
              <div>
                <button className="btn small" onClick={() => set("wordmark", [...draft.wordmark, { text: "" }])}>
                  <Plus size={14} /> Thêm chữ
                </button>
              </div>
            )}
            {Object.entries(issues)
              .filter(([path]) => path.startsWith("wordmark"))
              .map(([path, messages]) => (
                <span key={path} className="sf-error">
                  {path}: {messages.join("; ")}
                </span>
              ))}
          </div>
          <div className="logo-slots">
            {LOGOS.map((l) => (
              <div key={l.field} className="stack tight">
                <span className="field-label">
                  <strong>{l.label}</strong>
                  <span className="hint muted small">{l.hint}</span>
                </span>
                {imageSlot(`logo.${l.field}`, draft.logo[l.field], ["png"], () => set("logo", { ...draft.logo, [l.field]: undefined }))}
              </div>
            ))}
          </div>
          <span className="faint small">Không có wordmark lẫn logo thì video hiện tên brand. Style nền sáng dùng logo nền sáng, không có thì dùng logo nền tối.</span>
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          <h3>Outro và style</h3>
          <div className="row wrap">
            <Text label="Lời kêu gọi 16:9" value={draft.ctaLandscape.title} max={80} onChange={(v) => set("ctaLandscape", { ...draft.ctaLandscape, title: v })} errors={errors("cta.landscape.title")} />
            <Text label="Dòng phụ 16:9" value={draft.ctaLandscape.subtitle} max={120} onChange={(v) => set("ctaLandscape", { ...draft.ctaLandscape, subtitle: v })} errors={errors("cta.landscape.subtitle")} />
          </div>
          <div className="row wrap">
            <Text label="Lời kêu gọi 9:16" value={draft.ctaPortrait.title} max={80} onChange={(v) => set("ctaPortrait", { ...draft.ctaPortrait, title: v })} errors={errors("cta.portrait.title")} />
            <Text label="Dòng phụ 9:16" value={draft.ctaPortrait.subtitle} max={120} onChange={(v) => set("ctaPortrait", { ...draft.ctaPortrait, subtitle: v })} errors={errors("cta.portrait.subtitle")} />
          </div>
          <label className="field">
            <span className="field-label">
              Style mặc định <span className="hint">khi kịch bản không chọn style</span>
            </span>
            <select value={draft.defaultStyle} onChange={(e) => set("defaultStyle", e.target.value)}>
              {!styles.some((s) => s.id === draft.defaultStyle) && <option value={draft.defaultStyle}>{draft.defaultStyle}</option>}
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
            {errors("defaultStyle")}
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          <h3>Nhân vật (mascot)</h3>
          <div className="choice-group">
            {(
              [
                ["none", "Không có"],
                ["builtin", "Robot có sẵn"],
                ["image", "Ảnh của bạn"],
              ] as const
            ).map(([kind, label]) => (
              <label key={kind} className={`choice${draft.mascot.kind === kind ? " selected" : ""}`}>
                <input
                  type="radio"
                  checked={draft.mascot.kind === kind}
                  onChange={() =>
                    set("mascot", kind === "none" ? { kind } : kind === "builtin" ? { kind, name: draft.mascot.kind !== "none" ? draft.mascot.name : "" } : { kind, name: draft.mascot.kind !== "none" ? draft.mascot.name : "", poses: draft.mascot.kind === "image" ? draft.mascot.poses : {} })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          {draft.mascot.kind !== "none" && (
            <Text label="Tên nhân vật" value={draft.mascot.name} max={40} onChange={(v) => draft.mascot.kind !== "none" && set("mascot", { ...draft.mascot, name: v })} errors={errors("mascot.name")} />
          )}
          {imageMascot && (
            <div className="logo-slots">
              {MASCOT_POSES.map((pose: MascotPose) => (
                <div key={pose} className="stack tight">
                  <span className="field-label">
                    <strong>{POSE_LABEL[pose]}</strong>
                    <span className="hint muted small">{pose === "idle" ? "bắt buộc" : "không có thì dùng ảnh đứng yên"}</span>
                  </span>
                  {imageSlot(`mascot.poses.${pose}`, imageMascot.poses[pose], ["png", "jpg", "jpeg", "webp"], () => set("mascot", { ...imageMascot, poses: { ...imageMascot.poses, [pose]: undefined } }))}
                </div>
              ))}
            </div>
          )}
          <span className="faint small">Ảnh PNG nền trong suốt, cao khoảng 600 px. Nhân vật hiện ở intro, câu hỏi, outro và các cảnh kịch bản gọi đến.</span>
        </div>
      </div>
    </div>
  );
}

function Text({ label, hint, value, max, onChange, errors }: { label: string; hint?: string; value: string; max: number; onChange: (v: string) => void; errors?: React.ReactNode }) {
  return (
    <label className="field grow">
      <span className="field-label">
        {label} {hint && <span className="hint">{hint}</span>}
      </span>
      <input type="text" value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />
      {errors}
    </label>
  );
}
