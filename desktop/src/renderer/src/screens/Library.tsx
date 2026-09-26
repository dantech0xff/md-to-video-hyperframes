/** The library (design doc §7): the user's brand kits and sounds, for every video on this machine. */
import { useState } from "react";
import { Copy, FolderOpen, Palette, Pencil, Plus, Star, Trash2, Undo2, AudioLines, Brush } from "lucide-react";
import type { BrandKitInfo, Library } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke } from "../lib/api";
import { Banner, ErrorBanner, Spinner, useAction, useLoad } from "../components/ui";
import { BrandEditor } from "./BrandEditor";
import { SoundsTab } from "./SoundsTab";

type Tab = "brands" | "sounds";

export function LibraryScreen() {
  const [tab, setTab] = useState<Tab>("brands");
  const library = useLoad(() => invoke("library:get"), []);
  const settings = useLoad(() => invoke("settings:get"), []);
  const [editing, setEditing] = useState<string>();

  if (editing) {
    return (
      <div className="page" style={{ maxWidth: 880 }}>
        <BrandEditor
          id={editing}
          onDone={() => {
            setEditing(undefined);
            void library.reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Thư viện</h1>
          <p className="sub">
            Brand kit và âm thanh của bạn, dùng cho mọi video trên máy này. Agent thấy chúng qua tool <span className="mono">list_catalog</span>.
          </p>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab${tab === "brands" ? " active" : ""}`} onClick={() => setTab("brands")}>
          <Palette size={15} /> Brand kit
        </button>
        <button className={`tab${tab === "sounds" ? " active" : ""}`} onClick={() => setTab("sounds")}>
          <AudioLines size={15} /> Âm thanh
        </button>
      </div>
      <ErrorBanner error={library.error ?? settings.error} />
      {!library.data || !settings.data ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : tab === "brands" ? (
        <BrandsTab library={library.data} defaultBrand={settings.data.brand} onEdit={setEditing} onChanged={() => void Promise.all([library.reload(), settings.reload()])} />
      ) : (
        <SoundsTab library={library.data} onChanged={() => void library.reload()} />
      )}
    </div>
  );
}

function BrandsTab({ library, defaultBrand, onEdit, onChanged }: { library: Library; defaultBrand: string; onEdit: (id: string) => void; onChanged: () => void }) {
  const [creating, setCreating] = useState(false);
  const act = useAction();
  const run = (fn: () => Promise<unknown>) => void act.run(fn).then((ok) => ok && onChanged());
  const kits = [...library.brands].sort((a, b) => Number(b.id === defaultBrand) - Number(a.id === defaultBrand) || a.name.localeCompare(b.name, "vi"));

  return (
    <div className="stack">
      <div className="row">
        <span className="muted grow">
          Brand kit gồm tên, logo, tagline, lời kêu gọi ở outro và style mặc định. Kit đi kèm app không sửa trực tiếp: bấm Tuỳ chỉnh để có bản riêng thay cho nó.
        </span>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> Tạo brand kit
        </button>
      </div>
      {creating && (
        <NewBrand
          kits={library.brands}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onChanged();
            onEdit(id);
          }}
        />
      )}
      <ErrorBanner error={act.error} />
      <div className="brand-grid">
        {kits.map((kit) => (
          <BrandCard key={kit.id} kit={kit} isDefault={kit.id === defaultBrand} busy={act.busy}>
            {kit.source === "user" ? (
              <>
                <button className="btn small" onClick={() => onEdit(kit.id)}>
                  <Pencil size={14} /> Sửa
                </button>
                <button className="btn small" title="Mở thư mục của brand kit" onClick={() => run(() => invoke("library:reveal", "brands", kit.id))}>
                  <FolderOpen size={14} />
                </button>
                <button
                  className="btn small"
                  title={kit.replacesBundled ? "Bỏ bản riêng: dùng lại bản đi kèm app" : "Chuyển vào thùng rác"}
                  onClick={() => {
                    const ask = kit.replacesBundled ? `Bỏ bản riêng của "${kit.name}" và dùng lại bản đi kèm app?` : `Chuyển brand kit "${kit.name}" vào thùng rác?`;
                    if (window.confirm(ask)) run(() => invoke("library:delete-brand", kit.id));
                  }}
                >
                  {kit.replacesBundled ? <Undo2 size={14} /> : <Trash2 size={14} />}
                </button>
              </>
            ) : (
              <button className="btn small" onClick={() => run(async () => onEdit((await invoke("library:customize-brand", kit.id), kit.id)))}>
                <Brush size={14} /> Tuỳ chỉnh
              </button>
            )}
            <button className="btn small" title="Tạo brand kit mới từ kit này" onClick={() => run(async () => onEdit(await invoke("library:create-brand", `${kit.name} (bản sao)`.slice(0, 60), kit.id)))}>
              <Copy size={14} /> Nhân bản
            </button>
            {kit.id !== defaultBrand && (
              <button className="btn small" title="Video mới dùng brand kit này" onClick={() => run(() => invoke("settings:save", { settings: { brand: kit.id } }))}>
                <Star size={14} /> Mặc định
              </button>
            )}
          </BrandCard>
        ))}
      </div>
    </div>
  );
}

function NewBrand({ kits, onCancel, onCreated }: { kits: BrandKitInfo[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const create = useAction();
  return (
    <div className="card">
      <div className="card-body stack">
        <div className="row wrap">
          <label className="field grow">
            Tên brand
            <input type="text" autoFocus value={name} maxLength={60} placeholder="Ví dụ: Acme Academy" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Bắt đầu từ
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Kit trống</option>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorBanner error={create.error} />
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={onCancel}>
            Huỷ
          </button>
          <button className="btn primary" disabled={!name.trim() || create.busy} onClick={() => void create.run(async () => onCreated(await invoke("library:create-brand", name.trim(), from || undefined)))}>
            {create.busy ? <Spinner size={14} /> : <Plus size={15} />} Tạo
          </button>
        </div>
      </div>
    </div>
  );
}

function BrandCard({ kit, isDefault, busy, children }: { kit: BrandKitInfo; isDefault: boolean; busy: boolean; children: React.ReactNode }) {
  return (
    <div className="card brand-card">
      <BrandPreview kit={kit} />
      <div className="card-body stack tight">
        <div className="row wrap">
          <strong className="grow ellipsis">{kit.name}</strong>
          {isDefault && <span className="badge green">Mặc định</span>}
          {kit.source === "bundled" ? <span className="badge">Đi kèm app</span> : kit.replacesBundled ? <span className="badge blue">Bản riêng</span> : <span className="badge blue">Của bạn</span>}
        </div>
        <span className="mono faint small">{kit.id}</span>
        {kit.tagline && <span className="muted small">{kit.tagline}</span>}
        <span className="faint small">Style mặc định: {kit.defaultStyle || "?"}</span>
        {kit.problems.length > 0 && (
          <Banner kind="warn">
            <div className="stack tight small">
              {kit.problems.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          </Banner>
        )}
        <div className="row wrap" style={{ marginTop: 6, pointerEvents: busy ? "none" : undefined }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** How the kit's logo shows on a dark scene: its wordmark, its PNG, or its name. */
export function BrandPreview({ kit }: { kit: Pick<BrandKitInfo, "name" | "wordmark" | "logo"> }) {
  return (
    <div className="brand-preview">
      {kit.wordmark?.length ? (
        <div className="wordmark">
          {kit.wordmark.map((p, i) => (
            <span key={i} style={p.color ? { color: p.color } : undefined}>
              {p.text}
            </span>
          ))}
        </div>
      ) : kit.logo.onDark ? (
        <img src={mediaUrl(kit.logo.onDark)} alt={kit.name} />
      ) : (
        <div className="wordmark">
          <span>{kit.name}</span>
        </div>
      )}
    </div>
  );
}
