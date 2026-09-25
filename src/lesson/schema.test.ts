import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LessonScriptSchema } from "./schema.js";

const base = (scenes: unknown[]) => ({ version: "2.0", lesson: { title: "Bài test" }, chapters: [{ title: "Một", scenes }] });
const statement = { type: "statement", voice: "Xin chào.", text: "Xin chào" };

describe("LessonScriptSchema", () => {
  it("accepts the bundled example lesson", () => {
    const raw = JSON.parse(readFileSync(new URL("../../examples/lessons/repository-pattern/script.json", import.meta.url), "utf8"));
    const r = LessonScriptSchema.safeParse(raw);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues, null, 2));
    expect(r.data.chapters.length).toBeGreaterThan(1);
  });

  it("fills defaults", () => {
    const s = LessonScriptSchema.parse(base([statement]));
    expect(s.brand).toBe("dan-tech");
    expect(s.formats).toEqual(["landscape"]);
    expect(s.intro).toBe("auto");
    expect(s.mascot).toBe("auto");
    expect(s.outro.enabled).toBe(true);
  });

  it("rejects a quiz answer out of range", () => {
    const r = LessonScriptSchema.safeParse(base([{ type: "quiz", voice: "Hỏi?", question: "Hỏi?", options: ["A", "B"], answer: 2 }]));
    expect(r.success).toBe(false);
  });

  it("rejects duplicate scene ids", () => {
    const r = LessonScriptSchema.safeParse(base([{ ...statement, id: "a" }, { ...statement, id: "a" }]));
    expect(r.success).toBe(false);
  });

  it("rejects diagram edges to unknown nodes", () => {
    const diagram = {
      type: "diagram",
      voice: "Sơ đồ.",
      nodes: [{ id: "app", label: "App" }, { id: "db", label: "DB" }],
      edges: [{ from: "app", to: "cache" }],
    };
    expect(LessonScriptSchema.safeParse(base([diagram])).success).toBe(false);
  });

  it("rejects compare rows with the wrong number of values", () => {
    const compare = { type: "compare", voice: "So sánh.", columns: ["A", "B"], rows: [{ label: "x", values: [true] }] };
    expect(LessonScriptSchema.safeParse(base([compare])).success).toBe(false);
  });

  it("accepts every mascot form and rejects unknown poses", () => {
    for (const mascot of [false, "wave", { pose: "point", say: "Chú ý nhé!" }, { pose: "think", side: "left", talk: false }]) {
      expect(LessonScriptSchema.safeParse(base([{ ...statement, mascot }])).success).toBe(true);
    }
    expect(LessonScriptSchema.safeParse(base([{ ...statement, mascot: "dance" }])).success).toBe(false);
    expect(LessonScriptSchema.safeParse({ ...base([statement]), mascot: "off" }).success).toBe(true);
  });
});
