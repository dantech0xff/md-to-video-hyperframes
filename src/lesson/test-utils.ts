/** Test helpers: plan lessons without calling a TTS service. */
import type { SceneEntry, PreparedVoice, SegmentAudio } from "./plan.js";
import { prepareVoice } from "./plan.js";
import { estimateWordTimings } from "./timing.js";
import { LessonScriptSchema, type LessonScript } from "./schema.js";

/** Voice map for buildTimeline() with estimated word timings (~0.28 s per word). */
export function fakeVoiceMap(entries: SceneEntry[]): Map<string, { prepared: PreparedVoice; audio: SegmentAudio[] } | null> {
  const map = new Map<string, { prepared: PreparedVoice; audio: SegmentAudio[] } | null>();
  for (const e of entries) {
    const prepared = prepareVoice(e.voice, null);
    if (!prepared) {
      map.set(e.key, null);
      continue;
    }
    map.set(e.key, {
      prepared,
      audio: prepared.segments.map((seg, i) => {
        const duration = seg.spoken ? 0.3 + seg.spoken.split(/\s+/).length * 0.28 : 0;
        return { path: seg.spoken ? `voice/${e.key}-${i}.mp3` : null, duration, words: estimateWordTimings(seg.spoken, duration) };
      }),
    });
  }
  return map;
}

/** Two-chapter lesson touching cues, beats, pauses, code and quiz. */
export const lessonFixture = (): LessonScript =>
  LessonScriptSchema.parse({
    version: "2.0",
    lesson: { title: "Bài test", series: "Kotlin Mobile Pro", episode: 1 },
    chapters: [
      {
        title: "Mở đầu",
        scenes: [
          { type: "title", id: "hook", voice: "Chào mừng bạn đến với bài học.", title: "Chào" },
          { type: "bullets", id: "list", voice: "Thứ nhất {1}cache, thứ hai {2}network.", title: "Hai ý", items: ["Cache", "Network"] },
        ],
      },
      {
        title: "Thực hành",
        scenes: [
          {
            type: "code",
            id: "code",
            voice: "Đây là hàm {L2}lấy dữ liệu {cache}từ cache.",
            lang: "kotlin",
            code: "fun load() {\n  val x = 1\n  return x\n}",
            beats: [{ at: "{cache}", do: "focus", lines: "3", note: "trả về" }],
          },
          { type: "quiz", id: "quiz", voice: "Chọn đáp án đúng. {pause:3} {answer}Đáp án là B.", question: "Câu hỏi?", options: ["A", "B"], answer: 1 },
        ],
      },
    ],
    outro: { next: "Bài 2", voice: "Hẹn gặp lại bạn." },
  });
