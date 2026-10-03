import type { AgentId, AgentStatus, Catalog, FormatName, StoryboardJob, StoryboardScene, VideoState, VideoTarget, VoiceProfile } from "../../../shared/types";

/** The video the user picked while it has a script, else the first one that has (a lesson's Short can come first). */
export function shownVideo(videos: Pick<VideoState, "id" | "exists">[], picked: VideoTarget["id"]): VideoTarget["id"] {
  const written = videos.filter((v) => v.exists);
  return written.some((v) => v.id === picked) ? picked : (written[0]?.id ?? picked);
}

/** The format the user picked when the video has it, else the video's first. */
export function shownFormat(video: Pick<VideoState, "formats">, picked: FormatName): FormatName {
  return video.formats.some((f) => f.format === picked) ? picked : (video.formats[0]?.format ?? "landscape");
}

/**
 * What the Storyboard tab says about the app's builds of the video: the one
 * running; one that failed or that the user stopped, while the storyboard is
 * missing or out of date, to start again; or a storyboard out of date. A
 * storyboard current since (the agent built it) leaves nothing to say.
 */
export function buildBanner(build: Pick<StoryboardJob, "status"> | undefined, review: { stale: boolean; storyboard?: string } | undefined): "building" | "failed" | "stopped" | "stale" | undefined {
  if (build?.status === "queued" || build?.status === "running") return "building";
  const wanted = !!review && (review.stale || !review.storyboard);
  // a failure stays until the review says otherwise
  if (build?.status === "failed" && (!review || wanted)) return "failed";
  if (build?.status === "cancelled" && wanted) return "stopped";
  return review?.stale ? "stale" : undefined;
}

/** A loaded review, when it is the one of the video and format picked: another's still shows while theirs loads. */
export function reviewFor<T extends { video: VideoTarget["id"]; format: FormatName }>(loaded: T | undefined, video: VideoTarget["id"], format: FormatName): T | undefined {
  return loaded?.video === video && loaded.format === format ? loaded : undefined;
}

type Row = Pick<StoryboardScene, "kind" | "chapterIndex">;

/**
 * Whether row `i` of a review is the last scene of its chapter: where its
 * "add a scene" strip goes. The next row alone does not tell: the intro plays
 * inside the first chapter, right after its first scene.
 */
export function isChapterEnd(rows: Row[], i: number): boolean {
  const row = rows[i];
  return row?.kind === "scene" && !rows.slice(i + 1).some((r) => r.kind === "scene" && r.chapterIndex === row.chapterIndex);
}

/** Whether the scene at row `i` is its chapter's only one: moved out of it, it takes the chapter away, with its title and card. */
export function emptiesChapter(rows: Row[], i: number): boolean {
  const row = rows[i];
  return row?.kind === "scene" && rows.filter((r) => r.kind === "scene" && r.chapterIndex === row.chapterIndex).length === 1;
}

/**
 * The storyboard notes of every format of `video`, kept on the parts they
 * were written for after a change gave parts new keys (`renamed`: old → new,
 * null for a part gone, whose note goes with it).
 */
export function notesAfter<N extends { scenes: Record<string, string> }>(book: Record<string, N>, video: VideoTarget["id"], renamed: Record<string, string | null> | undefined): Record<string, N> {
  if (!renamed) return book;
  const moved = (key: string) => Object.hasOwn(renamed, key);
  const out: Record<string, N> = {};
  for (const [at, notes] of Object.entries(book)) {
    if (!at.startsWith(`${video}:`)) {
      out[at] = notes;
      continue;
    }
    const scenes: Record<string, string> = {};
    for (const [key, note] of Object.entries(notes.scenes)) if (!moved(key)) scenes[key] = note;
    for (const [key, note] of Object.entries(notes.scenes)) {
      const to = moved(key) ? renamed[key] : null;
      if (to) scenes[to] = note;
    }
    out[at] = { ...notes, scenes };
  }
  return out;
}

/** The latest storyboard build the app made of the project's video: from the screen's events, else from the list it loaded. */
export function videoBuild(seen: StoryboardJob[], listed: StoryboardJob[] | undefined, projectId: string, video: VideoTarget["id"]): StoryboardJob | undefined {
  const of = (j: StoryboardJob) => j.projectId === projectId && j.video === video;
  return seen.find(of) ?? listed?.find(of);
}

/** A new video's voice: the one the user picked for it, else the default saved in Settings when it can be used (a clone voice needs its key). */
export function newVideoVoice(picked: VoiceProfile | undefined, voices: Catalog["voices"] | undefined): VoiceProfile {
  if (picked) return picked;
  return voices?.default === "clone" && voices.clone.available ? "clone" : "free";
}

/** A new video's agent: the one the user picked for it, else the default from Settings when it is installed, else the first one installed. */
export function newVideoAgent(picked: AgentId | undefined, agents: Pick<AgentStatus, "id" | "installed">[] | undefined, preferred: AgentId): AgentId {
  if (picked) return picked;
  if (!agents || agents.some((a) => a.id === preferred && a.installed)) return preferred;
  return agents.find((a) => a.installed)?.id ?? preferred;
}
