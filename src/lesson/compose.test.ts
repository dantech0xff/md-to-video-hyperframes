import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { composeLesson } from "./compose.js";
import { buildEntries, buildTimeline } from "./plan.js";
import { loadStyle } from "./styles.js";
import { loadBrand } from "./brand.js";
import { mascotFor } from "./mascot.js";
import type { FormatName, LessonScript } from "./schema.js";
import { fakeVoiceMap, lessonFixture } from "./test-utils.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "compose-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const brand = loadBrand("dan-tech-academy");

async function compose(script: LessonScript, format: FormatName = "landscape", runtimeJs = "/* runtime */") {
  const entries = buildEntries(script, format);
  const timeline = buildTimeline(entries, fakeVoiceMap(entries), loadStyle("dantech"), format);
  const out = await composeLesson({ runtimeJs, script, format, timeline, style: loadStyle("dantech"), brand, captions: null, scriptDir: dir, outDir: dir, audioFile: "audio.mp3" });
  return { ...out, timeline };
}

const section = (html: string, key: string) => {
  const start = html.indexOf(`id="sc-${key}"`);
  return html.slice(start, html.indexOf("</section>", start));
};

describe("composeLesson", () => {
  it("writes a HyperFrames composition with one section per scene", async () => {
    const { html, plan, timeline } = await compose(lessonFixture());
    expect(html).toContain('data-composition-id="lesson"');
    expect(html).toContain('data-width="1920" data-height="1080"');
    expect(html).toContain("window.__LESSON_PLAN__");
    expect(html).toContain("/* runtime */");
    expect(html.match(/<section class="scene/g)).toHaveLength(timeline.scenes.length);
    expect((plan.scenes as unknown[]).length).toBe(timeline.scenes.length);
    expect(html).toContain('<audio id="lesson-audio"');
  });

  it("avoids patterns HyperFrames lint flags", async () => {
    const { html } = await compose(lessonFixture());
    expect(html).not.toMatch(/<img[^>]+brand\//);
    expect(html).not.toContain("data-layer=");
    expect(html).not.toContain('src="lesson-runtime.js"');
  });

  it("escapes </script> inside the inlined runtime", async () => {
    const { html } = await compose(lessonFixture(), "landscape", 'var s = "</script>";');
    expect(html).toContain('var s = "<\\/script>";');
  });

  it("adds the mascot to intro, quiz and outro with lip-sync timings", async () => {
    const { html, plan } = await compose(lessonFixture());
    expect(section(html, "intro")).toContain('data-pose="wave"');
    expect(section(html, "quiz")).toContain('class="mascot mascot--builtin" data-side="right" data-pose="think"');
    expect(section(html, "outro")).toContain('class="mascot');
    expect(section(html, "list")).not.toContain('class="mascot');
    const quiz = (plan.scenes as { key: string; meta: { mascot?: { pose: string }; talk?: number[][] } }[]).find((s) => s.key === "quiz")!;
    expect(quiz.meta.mascot?.pose).toBe("think");
    expect(quiz.meta.talk?.length).toBeGreaterThan(3);
  });

  it("puts the mascot bottom-left in portrait and removes it with mascot: off", async () => {
    const { html } = await compose(lessonFixture(), "portrait");
    expect(section(html, "quiz")).toContain('data-side="left"');
    const off = await compose({ ...lessonFixture(), mascot: "off" });
    expect(off.html).not.toContain('class="mascot');
  });
});

describe("mascotFor", () => {
  const script = lessonFixture();
  const entries = buildEntries(script, "landscape");
  const tl = buildTimeline(entries, fakeVoiceMap(entries), loadStyle("dantech"), "landscape");
  const scene = (key: string) => tl.scenes.find((s) => s.key === key)!;

  it("follows the scene's own setting before the automatic ones", () => {
    const list = scene("list");
    expect(mascotFor(list, script, brand, false)).toBeNull();
    const pointing = { ...list, spec: { ...list.spec!, mascot: { pose: "point" as const, say: "Chú ý!" } } };
    expect(mascotFor(pointing, script, brand, false)).toEqual({ pose: "point", side: "right", say: "Chú ý!", talk: true });
    const hidden = { ...scene("quiz"), spec: { ...scene("quiz").spec!, mascot: false as const } };
    expect(mascotFor(hidden, script, brand, false)).toBeNull();
    expect(mascotFor(scene("intro"), script, brand, false)).toMatchObject({ pose: "wave", talk: false });
  });

  it("stays away when the brand has no mascot", () => {
    expect(mascotFor(scene("quiz"), script, { ...brand, mascot: undefined }, false)).toBeNull();
  });
});
