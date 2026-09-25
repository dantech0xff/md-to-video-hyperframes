/** Results and publish kit (design doc §3, step 6): the videos, each part of youtube.md to copy, subtitles and chapters. */
import { FileVideo, FolderOpen } from "lucide-react";
import type { ProjectDetail, VideoState } from "../../../shared/types";
import { mediaUrl } from "../../../shared/media";
import { invoke } from "../lib/api";
import { clock, FORMAT_LABEL } from "../lib/format";
import { parsePublishKit } from "../lib/publish-kit";
import { Banner, CopyButton, ErrorBanner, useLoad } from "../components/ui";

export function ResultTab({ project }: { project: ProjectDetail }) {
  const written = project.videos.filter((v) => v.exists);
  if (!written.length)
    return (
      <div className="card">
        <div className="empty">
          <FileVideo size={30} />
          <h3>Chưa có kết quả</h3>
          <p>Video, phụ đề và bộ file đăng bài sẽ hiện ở đây sau khi render.</p>
        </div>
      </div>
    );
  return (
    <div className="stack">
      {written.map((v) => (
        <VideoResult key={v.id} project={project} video={v} />
      ))}
    </div>
  );
}

function rel(dir: string, path: string): string {
  const d = dir.replace(/\\/g, "/");
  const p = path.replace(/\\/g, "/");
  return p.startsWith(`${d}/`) ? p.slice(d.length + 1) : p;
}

function VideoResult({ project, video }: { project: ProjectDetail; video: VideoState }) {
  const kit = useLoad(() => (video.youtubeExists ? invoke("projects:read-text", project.id, video.youtube) : Promise.resolve("")), [project.id, video.youtube, video.youtubeExists, project.updatedAt]);
  const sections = kit.data ? parsePublishKit(kit.data) : [];
  const chapters = video.formats.find((f) => f.chapters)?.chapters;
  const chapterText = useLoad(() => (chapters ? invoke("projects:read-text", project.id, rel(project.dir, chapters)) : Promise.resolve("")), [chapters, project.updatedAt]);

  return (
    <div className="card">
      <div className="card-body stack">
        <div className="card-title" style={{ marginBottom: 0 }}>
          <h2>{video.label}</h2>
          <button className="btn small" onClick={() => void invoke("projects:reveal", project.id)}>
            <FolderOpen size={13} /> Mở thư mục dự án
          </button>
        </div>

        {video.formats.map((f) => (
          <div key={f.format} className="stack tight">
            <div className="row">
              <strong>{FORMAT_LABEL[f.format]}</strong>
              {f.duration !== undefined && <span className="small muted">{clock(f.duration)}</span>}
              <span className="grow" />
              {f.video && (
                <button className="btn small" onClick={() => void invoke("projects:reveal", project.id, rel(project.dir, f.video!))}>
                  <FileVideo size={13} /> Hiện video.mp4
                </button>
              )}
              {f.captions && (
                <button className="btn small" onClick={() => void invoke("projects:reveal", project.id, rel(project.dir, f.captions!))}>
                  Phụ đề .srt
                </button>
              )}
            </div>
            {f.videoStale && <Banner kind="warn">Kịch bản đã sửa sau lần render này: video chưa có các thay đổi mới. Render lại ở tab Render.</Banner>}
            {f.video ? (
              <video className={`player${f.format === "portrait" ? " portrait" : ""}`} src={mediaUrl(f.video, project.updatedAt)} controls preload="metadata" />
            ) : (
              <span className="small muted">Chưa render định dạng này.</span>
            )}
          </div>
        ))}

        {chapterText.data && (
          <div className="kit-section">
            <div className="row">
              <strong className="grow">Chương (chapters.txt)</strong>
              <CopyButton text={chapterText.data} />
            </div>
            <pre className="pre-wrap">{chapterText.data}</pre>
          </div>
        )}

        <h3 style={{ marginTop: 6 }}>Bộ file đăng bài</h3>
        {!video.youtubeExists ? (
          <span className="small muted">Agent chưa viết {video.youtube}.</span>
        ) : sections.length ? (
          sections.map((s) => (
            <div key={s.label} className="kit-section">
              <div className="row">
                <strong className="grow">{s.label}</strong>
                <CopyButton text={s.text} />
              </div>
              <div className="pre-wrap">{s.text}</div>
            </div>
          ))
        ) : (
          <div className="kit-section">
            <div className="row">
              <strong className="grow">{video.youtube}</strong>
              {kit.data && <CopyButton text={kit.data} />}
            </div>
            <div className="pre-wrap">{kit.data}</div>
          </div>
        )}
        <ErrorBanner error={kit.error ?? chapterText.error} />
      </div>
    </div>
  );
}
