/** Side outputs for publishing: subtitles (SRT/VTT), YouTube chapters, narration text. */
import type { LessonTimeline } from "./plan.js";
import { buildCaptionGroups } from "./plan.js";

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");

function stamp(t: number, sep: "," | "."): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(timeline: LessonTimeline): string {
  return buildCaptionGroups(timeline, 9)
    .map((g, i) => `${i + 1}\n${stamp(g.start, ",")} --> ${stamp(g.end, ",")}\n${g.words.map((w) => w.text).join(" ")}\n`)
    .join("\n");
}

export function toVtt(timeline: LessonTimeline): string {
  return (
    "WEBVTT\n\n" +
    buildCaptionGroups(timeline, 9)
      .map((g) => `${stamp(g.start, ".")} --> ${stamp(g.end, ".")}\n${g.words.map((w) => w.text).join(" ")}\n`)
      .join("\n")
  );
}

/** YouTube chapter list ("00:00 Mở đầu"); YouTube needs ≥3 chapters of ≥10s starting at 00:00. */
export function toChapters(timeline: LessonTimeline, introTitle = "Mở đầu"): string {
  const fmt = (t: number) => {
    const s = Math.floor(t);
    const h = Math.floor(s / 3600);
    return h > 0 ? `${h}:${pad((s % 3600) / 60)}:${pad(s % 60)}` : `${pad(s / 60)}:${pad(s % 60)}`;
  };
  const lines = [`${fmt(0)} ${introTitle}`];
  for (const c of timeline.chapters) {
    const card = timeline.scenes.find((s) => s.kind === "chapter" && s.chapterIndex === c.index);
    const t = card ? card.start : c.start;
    if (t < 5) continue;
    lines.push(`${fmt(t)} Phần ${c.index + 1}: ${c.title}`);
  }
  return lines.join("\n") + "\n";
}

export function toScriptText(timeline: LessonTimeline): string {
  return timeline.scenes.map((s) => s.text).filter(Boolean).join("\n\n") + "\n";
}
