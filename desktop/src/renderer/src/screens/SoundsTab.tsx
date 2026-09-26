/** The library's sounds: SFX and music, played, added, renamed and removed; and what each style plays. */
import { useEffect, useRef, useState } from "react";
import { Check, FolderOpen, Pause, Pencil, Play, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { Library, LibrarySound, SoundKind } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke } from "../lib/api";
import { EVENT_LABEL, groupSounds, soundBase, soundFolders } from "../lib/library";
import { Banner, ErrorBanner, Spinner, useAction, useLoad } from "../components/ui";

const AUDIO = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
const KIND_LABEL: Record<SoundKind, string> = { sfx: "Hiệu ứng (SFX)", music: "Nhạc nền" };

export function SoundsTab({ library, onChanged }: { library: Library; onChanged: () => void }) {
  const [kind, setKind] = useState<SoundKind>("sfx");
  const sounds = library[kind];
  const act = useAction();
  const run = (fn: () => Promise<unknown>) => void act.run(fn).then((ok) => ok && onChanged());
  const player = usePlayer();
  const hasStarter = [...library.sfx, ...library.music].some((s) => s.starter);

  return (
    <div className="stack">
      <div className="row wrap">
        <div className="segmented">
          {(["sfx", "music"] as const).map((k) => (
            <button key={k} className={k === kind ? "active" : ""} onClick={() => setKind(k)}>
              {KIND_LABEL[k]} <span className="faint">{library[k].filter((s) => !s.starter).length}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn small" onClick={() => run(() => invoke("library:reveal", kind))}>
          <FolderOpen size={14} /> Mở thư mục
        </button>
        {!hasStarter && (
          <button className="btn small" title="Tạo bộ âm thanh mẫu bằng FFmpeg, dùng khi thư viện chưa có file hợp" onClick={() => run(() => invoke("library:starter-sounds"))}>
            <Sparkles size={14} /> Tạo âm thanh mẫu
          </button>
        )}
      </div>
      <span className="muted">
        Engine chọn âm thanh theo tên file: style tìm các chữ như <span className="mono">whoosh</span>, <span className="mono">pop</span>, <span className="mono">ding</span> trong tên, file của bạn
        trước, âm thanh mẫu sau. Kịch bản cũng gọi được một file theo tên. Xem bảng bên dưới để biết mỗi style dùng file nào.
      </span>
      <AddSounds kind={kind} folders={soundFolders(sounds)} onAdded={onChanged} />
      <ErrorBanner error={act.error} />
      {act.busy && <Spinner />}
      {sounds.length === 0 ? (
        <div className="empty">
          <h3>Chưa có {kind === "sfx" ? "hiệu ứng" : "nhạc nền"} nào</h3>
          <span>Thêm file của bạn, hoặc tạo bộ âm thanh mẫu để video có tiếng ngay.</span>
        </div>
      ) : (
        groupSounds(sounds).map((g) => (
          <div key={`${g.starter}:${g.category}`} className="card">
            <div className="card-body stack tight">
              <div className="row">
                <strong className="grow">{g.category || "Chung"}</strong>
                {g.starter && <span className="badge">Âm thanh mẫu: chỉ dùng khi không file nào của bạn hợp</span>}
              </div>
              {g.sounds.map((s) => (
                <SoundRow key={s.file} sound={s} kind={kind} player={player} busy={act.busy} run={run} />
              ))}
            </div>
          </div>
        ))
      )}
      <StyleSoundsPanel stamp={[...library.sfx, ...library.music].map((s) => s.name).join("\n")} />
    </div>
  );
}

function SoundRow({ sound, kind, player, busy, run }: { sound: LibrarySound; kind: SoundKind; player: Player; busy: boolean; run: (fn: () => Promise<unknown>) => void }) {
  const [renaming, setRenaming] = useState<string>();
  const playing = player.playing === sound.file;
  return (
    <div className="sound-row">
      <button className="btn small icon" title={playing ? "Dừng" : "Nghe thử"} onClick={() => player.toggle(sound.file)}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      {renaming !== undefined ? (
        <>
          <input type="text" autoFocus value={renaming} maxLength={80} onChange={(e) => setRenaming(e.target.value)} className="grow" />
          <button
            className="btn small"
            title="Đổi tên"
            disabled={busy || !renaming.trim()}
            onClick={() => {
              run(() => invoke("library:rename-sound", kind, sound.file, renaming.trim()));
              setRenaming(undefined);
            }}
          >
            <Check size={14} />
          </button>
          <button className="btn small" title="Huỷ" onClick={() => setRenaming(undefined)}>
            <X size={14} />
          </button>
        </>
      ) : (
        <>
          <span className="grow ellipsis">
            {soundBase(sound)} <span className="faint small mono">{sound.name}</span>
          </span>
          {!sound.starter && (
            <>
              <button className="btn small" title="Đổi tên" onClick={() => setRenaming(soundBase(sound))}>
                <Pencil size={14} />
              </button>
              <button className="btn small" title="Chuyển vào thùng rác" onClick={() => window.confirm(`Chuyển "${soundBase(sound)}" vào thùng rác?`) && run(() => invoke("library:delete-sound", kind, sound.file))}>
                <Trash2 size={14} />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function AddSounds({ kind, folders, onAdded }: { kind: SoundKind; folders: string[]; onAdded: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const add = useAction();
  useEffect(() => setFiles([]), [kind]);
  const choose = () => void add.run(async () => setFiles(await invoke("dialog:files", "Chọn file âm thanh", AUDIO)));

  if (!files.length) {
    return (
      <div>
        <button className="btn" onClick={choose}>
          <Upload size={15} /> Thêm file âm thanh
        </button>
        <ErrorBanner error={add.error} />
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-body stack">
        <span>
          {files.length} file: <span className="muted">{files.map((f) => f.split(/[\\/]/).pop()).join(", ")}</span>
        </span>
        <label className="field">
          <span className="field-label">
            Thư mục <span className="hint">chỉ để xếp gọn; tên thư mục cũng được tìm như tên file</span>
          </span>
          <input type="text" list="sound-folders" value={folder} maxLength={40} placeholder="Để trống: thư mục chung" onChange={(e) => setFolder(e.target.value)} />
          <datalist id="sound-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <ErrorBanner error={add.error} />
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={() => setFiles([])}>
            Huỷ
          </button>
          <button
            className="btn primary"
            disabled={add.busy}
            onClick={() =>
              void add.run(async () => {
                await invoke("library:import-sounds", kind, files, folder.trim());
                setFiles([]);
                onAdded();
              })
            }
          >
            {add.busy ? <Spinner size={14} /> : <Upload size={15} />} Thêm vào {KIND_LABEL[kind].toLowerCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

/** `stamp` changes with the library: the table reloads. */
function StyleSoundsPanel({ stamp }: { stamp: string }) {
  const catalog = useLoad(() => invoke("catalog:get"), []);
  const [style, setStyle] = useState("dantech");
  const sounds = useLoad(() => invoke("library:style-sounds", style), [style, stamp]);
  const found = (s: { sounds: string[]; starter: boolean; prefs: string[] }) =>
    s.sounds.length ? (
      <span>
        {s.sounds.join(", ")} {s.starter && <span className="badge">mẫu</span>}
      </span>
    ) : (
      <span className="faint">chưa có: đặt tên file có một trong các chữ bên trái</span>
    );
  return (
    <div className="card">
      <div className="card-body stack">
        <div className="card-title">
          <h3>Style dùng âm thanh nào</h3>
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            {(catalog.data?.styles ?? [{ id: "dantech", name: "Dan Tech" }]).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.id})
              </option>
            ))}
          </select>
        </div>
        <ErrorBanner error={sounds.error} />
        {sounds.data ? (
          <table className="sound-table">
            <thead>
              <tr>
                <th>Lúc</th>
                <th>Tìm theo chữ</th>
                <th>Sẽ dùng (mỗi lần chọn một)</th>
              </tr>
            </thead>
            <tbody>
              {sounds.data.sfx.map((e) => (
                <tr key={e.event}>
                  <td>{EVENT_LABEL[e.event] ?? e.event}</td>
                  <td className="mono small">{e.prefs.join(", ")}</td>
                  <td className="small">{found(e)}</td>
                </tr>
              ))}
              <tr>
                <td>Nhạc nền</td>
                <td className="mono small">{sounds.data.music.prefs.join(", ")}</td>
                <td className="small">{found(sounds.data.music)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Spinner />
        )}
        <Banner>Chưa có âm thanh nào hợp và thư viện trống thì engine tự tạo bộ âm thanh mẫu ở lần dựng đầu tiên.</Banner>
      </div>
    </div>
  );
}

interface Player {
  playing?: string;
  toggle(file: string): void;
}

/** One sound playing at a time. */
function usePlayer(): Player {
  const audio = useRef<HTMLAudioElement>(undefined);
  const [playing, setPlaying] = useState<string>();
  useEffect(() => () => audio.current?.pause(), []);
  return {
    playing,
    toggle(file) {
      audio.current?.pause();
      if (playing === file) {
        setPlaying(undefined);
        return;
      }
      const a = new Audio(mediaUrl(file));
      a.onended = () => setPlaying((p) => (p === file ? undefined : p));
      a.onerror = () => setPlaying((p) => (p === file ? undefined : p));
      audio.current = a;
      setPlaying(file);
      void a.play().catch(() => setPlaying(undefined));
    },
  };
}
