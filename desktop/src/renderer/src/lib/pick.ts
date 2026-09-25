import type { FormatName, VideoState, VideoTarget } from "../../../shared/types";

/** The video the user picked while it has a script, else the first one that has (a lesson's Short can come first). */
export function shownVideo(videos: Pick<VideoState, "id" | "exists">[], picked: VideoTarget["id"]): VideoTarget["id"] {
  const written = videos.filter((v) => v.exists);
  return written.some((v) => v.id === picked) ? picked : (written[0]?.id ?? picked);
}

/** The format the user picked when the video has it, else the video's first. */
export function shownFormat(video: Pick<VideoState, "formats">, picked: FormatName): FormatName {
  return video.formats.some((f) => f.format === picked) ? picked : (video.formats[0]?.format ?? "landscape");
}
