import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LessonScriptSchema, type FormatName, type LessonScript } from "./schema.js";
import { composeLesson } from "./compose.js";
import { buildEntries, buildTimeline, buildSfxEvents, buildCaptionGroups } from "./plan.js";
import { loadStyle } from "./styles.js";
import { loadBrand } from "./brand.js";
import { familyOf, shellState, hasTicker } from "./families.js";
import { withKeyword, viNumber } from "./compose-kit.js";
import { loadLessonCss, loadRuntimeJs } from "./pipeline.js";
import { fakeVoiceMap } from "./test-utils.js";

const SHOWCASE = new URL("../../examples/lessons/templates-showcase/", import.meta.url);
const showcase = () => LessonScriptSchema.parse(JSON.parse(readFileSync(new URL("script.json", SHOWCASE), "utf8")));
const base = (scenes: unknown[]) => ({ version: "2.0", lesson: { title: "Bài test" }, chapters: [{ title: "Một", scenes }] });
const ok = (scene: unknown) => LessonScriptSchema.safeParse(base([scene])).success;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "templates-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function compose(script: LessonScript, format: FormatName, style = "dantech") {
  const entries = buildEntries(script, format);
  const pack = loadStyle(style);
  const timeline = buildTimeline(entries, fakeVoiceMap(entries), pack, format);
  const captions = buildCaptionGroups(timeline, 4);
  const out = await composeLesson({
    runtimeJs: "/* runtime */", script, format, timeline, style: pack, brand: loadBrand(script.brand),
    captions, scriptDir: new URL(".", SHOWCASE).pathname, outDir: dir, audioFile: "audio.mp3",
  });
  return { ...out, timeline };
}

const section = (html: string, key: string) => {
  const start = html.indexOf(`id="sc-${key}"`);
  return html.slice(html.lastIndexOf("<section", start), html.indexOf("</section>", start));
};

describe("template scene schema", () => {
  it("accepts the showcase, one scene per catalog id", () => {
    const types = showcase().chapters.flatMap((c) => c.scenes.map((s) => s.type));
    expect(types).toContain("lesson.compare");
    expect(types).toContain("news.globe");
    expect(types).toContain("data.timeline");
    expect(types).toContain("energy.punch-3d");
    expect(types).toContain("3d.phone");
  });

  it("maps lesson.hook / lesson.concept / lesson.quiz to the classic scenes", () => {
    const s = LessonScriptSchema.parse(base([{ type: "lesson.hook", voice: "Chào.", title: "Chào bạn", keyword: "bạn" }]));
    expect(s.chapters[0].scenes[0].type).toBe("title");
    const q = LessonScriptSchema.parse(base([{ type: "lesson.quiz", voice: "?", question: "Q?", options: ["A", "B"], answer: 1 }]));
    expect(q.chapters[0].scenes[0].type).toBe("quiz");
  });

  it("requires the keyword to appear in its text", () => {
    expect(ok({ type: "news.quote", voice: "x", quote: "Nói thì dễ.", keyword: "dễ", person: "A", source: "B" })).toBe(true);
    expect(ok({ type: "news.quote", voice: "x", quote: "Nói thì dễ.", keyword: "khó", person: "A", source: "B" })).toBe(false);
    expect(ok({ type: "lesson.hook", voice: "x", title: "Chào", keyword: "bạn" })).toBe(false);
  });

  it("checks chart data", () => {
    const line = { type: "data.line", voice: "x", title: "T", points: [1, 2, 3], labels: ["a", "b", "c"], source: "s" };
    expect(ok(line)).toBe(true);
    expect(ok({ ...line, labels: ["a", "b"] })).toBe(false);
    expect(ok({ ...line, annotation: { i: 5, text: "x" } })).toBe(false);
    const tlScene = { type: "data.timeline", voice: "x", title: "T", range: [2010, 2020], events: [{ year: 2011, text: "a" }, { year: 2015, text: "b" }] };
    expect(ok(tlScene)).toBe(true);
    expect(ok({ ...tlScene, events: [{ year: 2009, text: "a" }, { year: 2015, text: "b" }] })).toBe(false);
    const db = { type: "data.dumbbell", voice: "x", title: "T", legend: ["a", "b"], rows: [{ label: "x", a: 1, b: 2 }, { label: "y", a: 3, b: 90 }], axisMax: 80, source: "s" };
    expect(ok(db)).toBe(false);
  });

  it("keeps numbers sourced and punches short", () => {
    expect(ok({ type: "data.waffle", voice: "x", percent: 64, label: "l" })).toBe(false);
    expect(ok({ type: "energy.punch", voice: "Sai.", punch: "SAI RỒI." })).toBe(true);
    expect(ok({ type: "energy.punch", voice: "Sai.", punch: "một hai ba bốn" })).toBe(false);
  });
});

describe("families", () => {
  it("assigns every catalog id a family", () => {
    expect(familyOf("news.top-n")).toBe("news");
    expect(familyOf("data.waffle")).toBe("data");
    expect(familyOf("energy.punch")).toBe("energy");
    expect(familyOf("energy.myth-fact")).toBe("lesson");
    expect(familyOf("3d.layers")).toBe("lesson");
    expect(familyOf("title")).toBe("lesson");
  });

  it("decides the shell per scene", () => {
    expect(shellState({ kind: "scene", type: "title", spec: undefined }, false)).toMatchObject({ pills: false, logo: "brand" });
    expect(shellState({ kind: "scene", type: "concept", spec: undefined }, false)).toMatchObject({ pills: true });
    expect(shellState({ kind: "scene", type: "energy.punch", spec: undefined }, false)).toMatchObject({ family: "energy", logo: "white" });
    expect(shellState({ kind: "scene", type: "energy.before-after", spec: undefined }, true)).toMatchObject({ logo: "brand" });
    expect(hasTicker("news.quote", false, false)).toBe(true);
    expect(hasTicker("news.globe", true, true)).toBe(false);
  });
});

describe("composing templates", () => {
  it("renders every template in both formats", async () => {
    for (const format of ["landscape", "portrait"] as const) {
      const { html, plan } = await compose(showcase(), format);
      for (const key of ["versus", "breaking", "top-n", "quote", "lower-third", "globe", "big-number", "dumbbell", "line", "waffle", "timeline", "punch", "myth-fact", "before-after", "big-rank", "layers-3d", "hero-3d", "phone-3d", "punch-3d"]) {
        expect(html, `${format} ${key}`).toContain(`id="sc-${key}"`);
      }
      const shells = (plan.scenes as { key: string; shell: { family: string } }[]).map((s) => [s.key, s.shell.family]);
      expect(shells).toContainEqual(["breaking", "news"]);
      expect(shells).toContainEqual(["waffle", "data"]);
      expect(shells).toContainEqual(["punch", "energy"]);
    }
  });

  it("follows the brand rules: text wordmark, pills, no dot separators", async () => {
    const { html } = await compose(showcase(), "landscape");
    expect(html).toContain('class="brand-logo brand-wordmark shell-logo"');
    expect(html).toContain('<span class="wm-part wm-accent" style="--wm-c:#47c038">Tech</span>');
    expect(html).toContain('<div class="pills shell-pills"><span class="pill pill--main">Bài học</span><span class="pill">Kiến thức</span>');
    expect(html).not.toMatch(/[^\s]\s·\s/);
    expect(html).not.toContain("Academy");
  });

  it("gives family backgrounds, tickers and caption colours", async () => {
    const { html } = await compose(showcase(), "portrait");
    expect(section(html, "breaking")).toContain('<div class="news-backdrop"></div><div class="news-dots"></div>');
    expect(section(html, "waffle")).toContain('<div class="data-backdrop"></div>');
    expect(section(html, "top-n")).toContain('class="ticker"');
    expect(section(html, "globe")).not.toContain('class="ticker"');
    expect(html).toMatch(/class="cap-group" data-g="\d+" data-family="news"/);
  });

  it("lays charts out in design pixels", async () => {
    const { html } = await compose(showcase(), "landscape");
    const db = section(html, "dumbbell");
    // Kotlin 58 → 64 of 80 on a 1100 px track
    expect(db).toContain('class="db-link" style="left:797.5px;width:82.5px"');
    expect(db).toContain("−5");
    const line = section(html, "line");
    expect(line).toContain(">1.500</div>");
    expect(line).toContain('data-count>1.640</span>');
    expect(section(html, "waffle").match(/<i class="on">/g)).toHaveLength(64);
    expect(section(html, "big-number")).toContain(">3,0</span>");
  });

  it("loads three.js only when a lesson has 3D scenes", async () => {
    const withThree = await compose(showcase(), "landscape");
    expect(withThree.html).toContain('<script src="vendor/three.js"></script>');
    const plain = LessonScriptSchema.parse(base([{ type: "title", voice: "Chào bạn.", title: "Chào" }]));
    expect((await compose(plain, "landscape")).html).not.toContain("vendor/three.js");
  });
});

describe("energy rules in the timeline", () => {
  it("keeps punch scenes short and gives energy scenes an impact hit", async () => {
    const script = showcase();
    const pack = loadStyle("dantech");
    const entries = buildEntries(script, "landscape");
    const tl = buildTimeline(entries, fakeVoiceMap(entries), pack, "landscape");
    const punch = tl.scenes.find((s) => s.key === "punch")!;
    expect(punch.end - punch.enterAt).toBeLessThan(1.6);
    const ev = buildSfxEvents(tl, pack);
    const impacts = ev.filter((e) => e.event === "impact").map((e) => e.seed.split(":")[0]);
    expect(impacts).toEqual(expect.arrayContaining(["punch", "punch-3d", "big-rank"]));
    // hook beat: whoosh at 0, pop at 0.18, ding on the keyword
    const hook = ev.filter((e) => e.seed.startsWith("hook:"));
    expect(hook.map((e) => e.event)).toEqual(["transition", "reveal", "highlight"]);
    expect(hook[1].t).toBeCloseTo(0.18, 2);
  });
});

describe("kit", () => {
  it("wraps the keyword and keeps trailing punctuation on its line", () => {
    expect(withKeyword("Nó là hàm tạm dừng.", "tạm dừng", "mf-kw")).toBe('Nó là hàm <span class="kw-glue"><em class="mf-kw">tạm dừng</em>.</span>');
    expect(withKeyword("Coroutines không khó", "khó")).toContain('<em class="kw"><span class="kw-bar"></span><span class="kw-text">khó</span></em>');
  });

  it("formats numbers the Vietnamese way", () => {
    expect(viNumber(1640)).toBe("1.640");
    expect(viNumber(4.2, 1)).toBe("4,2");
    expect(viNumber(-5)).toBe("−5");
  });
});

describe("style packs and assets", () => {
  it("dantech-punch extends dantech with faster motion", () => {
    const punch = loadStyle("dantech-punch");
    const base = loadStyle("dantech");
    expect(punch.motion.fast).toBeLessThan(base.motion.fast);
    expect(punch.motion.hook).toBe("beat");
    expect(punch.codeTheme).toBe(base.codeTheme);
    expect(punch.sfx.impact).toEqual(base.sfx.impact);
    expect(punch.css).toContain('[data-style="dantech-punch"] .node');
    expect(punch.css).not.toContain('[data-style="dantech"]');
  });

  it("uses one font and bundles the template runtime", async () => {
    expect(loadStyle("dantech").fonts.mono).toBe("Be Vietnam Pro");
    const css = await loadLessonCss("/* style */");
    expect(css).toContain(".vs-card");
    expect(css).toContain(".three-layer");
    const js = await loadRuntimeJs();
    expect(js.indexOf("__LESSON_TEMPLATES__")).toBeLessThan(js.indexOf("window.__timelines[P.compId]"));
    // deterministic frames: no wall clock or unseeded randomness in code (comments stripped)
    const code = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/requestAnimationFrame|Date\.now|Math\.random|performance\.now/);
  });

  it("still accepts the old brand id", () => {
    expect(loadBrand("dan-tech-academy").id).toBe("dan-tech");
  });
});
