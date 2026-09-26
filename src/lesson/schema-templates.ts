/**
 * Template scene types from the Dan Tech template system (TEMPLATES.md):
 * four families besides the classic lesson scenes, each with its own look.
 *
 *   lesson.*  lesson.compare (the other lesson.* ids alias classic scenes)
 *   news.*    breaking, top-n, quote, lower-third, globe
 *   data.*    big-number, dumbbell, line, waffle, timeline
 *   energy.*  punch, punch-3d, myth-fact, before-after, big-rank
 *   3d.*      layers, hero-object, phone
 *
 * `type` is the catalog id itself ("news.breaking"). Visible text fields
 * accept the usual inline markup; `keyword` names the one phrase of the
 * headline that gets the accent colour (at most one per sentence).
 */
import { z } from "zod";
import { common } from "./schema-common.js";

/** Catalog ids that are the classic scene types under a new name. */
export const TYPE_ALIASES: Record<string, string> = {
  "lesson.hook": "title",
  "lesson.concept": "concept",
  "lesson.quiz": "quiz",
};

const Tone = z.enum(["positive", "negative", "warning", "neutral"]);
const Keyword = z.string().min(1).max(40);
/** Image path (relative to the script) or URL; the Studio tools and the app take files inside the project only. */
const Media = z.string().min(1);
const Ticker = z.array(z.string().min(1).max(80)).min(1).max(6);
/** Every number states its source. */
const Source = z.string().min(1).max(90);

// ── lesson ────────────────────────────────────────────────────────────────

const VersusSide = z.object({
  name: z.string().min(1).max(24),
  /** small label on the recommended side, e.g. "Khuyên dùng"; that side gets the accent fill */
  badge: z.string().max(20).optional(),
  rows: z
    .array(z.object({ label: z.string().min(1).max(32), value: z.string().min(1).max(28), tone: Tone.optional() }))
    .min(1)
    .max(5),
});

const LessonCompare = z.object({
  type: z.literal("lesson.compare"),
  ...common,
  title: z.string().max(70).optional(),
  keyword: Keyword.optional(),
  left: VersusSide,
  right: VersusSide,
});

// ── news ──────────────────────────────────────────────────────────────────

const newsCommon = {
  /** category tag, e.g. "TIN NÓNG", "THẾ GIỚI" */
  label: z.string().min(1).max(24).optional(),
  /** items crawling in the ticker bar */
  ticker: Ticker.optional(),
  /** ticker block label (default "CẬP NHẬT") */
  tickerLabel: z.string().min(1).max(16).optional(),
};

const NewsBreaking = z.object({
  type: z.literal("news.breaking"),
  ...common,
  ...newsCommon,
  headline: z.string().min(1).max(110),
  keyword: Keyword.optional(),
  sub: z.string().max(160).optional(),
  facts: z.array(z.string().min(1).max(44)).max(4).optional(),
  image: Media.optional(),
});

const NewsTopN = z.object({
  type: z.literal("news.top-n"),
  ...common,
  ...newsCommon,
  /** e.g. "19–25.09.2026" */
  period: z.string().max(24).optional(),
  title: z.string().min(1).max(70),
  items: z
    .array(z.object({ title: z.string().min(1).max(60), source: z.string().max(30).optional(), time: z.string().max(16).optional() }))
    .min(2)
    .max(5),
});

const NewsQuote = z.object({
  type: z.literal("news.quote"),
  ...common,
  ...newsCommon,
  quote: z.string().min(1).max(140),
  keyword: Keyword.optional(),
  person: z.string().min(1).max(40),
  role: z.string().max(60).optional(),
  avatar: Media.optional(),
  source: Source,
});

const NewsLowerThird = z.object({
  type: z.literal("news.lower-third"),
  ...common,
  /** full-frame photo (Ken Burns) */
  media: Media,
  tag: z.string().min(1).max(20),
  name: z.string().min(1).max(40),
  role: z.string().max(60).optional(),
});

const NewsGlobe = z.object({
  type: z.literal("news.globe"),
  ...common,
  ...newsCommon,
  headline: z.string().min(1).max(90),
  keyword: Keyword.optional(),
  sub: z.string().max(140).optional(),
  markers: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        label: z.string().max(24).optional(),
        /** the story's location: red, labelled, the globe turns to face it */
        primary: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(8),
  source: Source.optional(),
});

// ── data ──────────────────────────────────────────────────────────────────

const DataBigNumber = z.object({
  type: z.literal("data.big-number"),
  ...common,
  /** as displayed, e.g. "4,2" (counts up from 0) */
  value: z.string().min(1).max(8),
  unit: z.string().max(8).optional(),
  label: z.string().min(1).max(110),
  delta: z.object({ value: z.string().min(1).max(8), sub: z.string().max(40).optional() }).optional(),
  /** small bars; the last one is the current value */
  series: z.array(z.object({ label: z.string().min(1).max(6), value: z.number().min(0), display: z.string().max(8).optional() })).max(5).optional(),
  source: Source,
});

const DataDumbbell = z.object({
  type: z.literal("data.dumbbell"),
  ...common,
  /** written as a conclusion, not a topic */
  title: z.string().min(1).max(70),
  keyword: Keyword.optional(),
  subtitle: z.string().max(70).optional(),
  /** names of the two points, e.g. ["2025", "2026"] */
  legend: z.tuple([z.string().min(1).max(12), z.string().min(1).max(12)]),
  rows: z
    .array(z.object({ label: z.string().min(1).max(16), a: z.number(), b: z.number(), highlight: z.boolean().optional() }))
    .min(2)
    .max(6),
  axisMax: z.number().positive(),
  unit: z.string().max(4).optional(),
  source: Source,
});

const DataLine = z.object({
  type: z.literal("data.line"),
  ...common,
  title: z.string().min(1).max(70),
  keyword: Keyword.optional(),
  subtitle: z.string().max(70).optional(),
  points: z.array(z.number()).min(2).max(24),
  /** x-axis labels, one per point */
  labels: z.array(z.string().min(1).max(8)),
  annotation: z.object({ i: z.number().int().min(0), text: z.string().min(1).max(70) }).optional(),
  /** caption under the final value, e.g. "tháng 9" */
  lastLabel: z.string().max(20).optional(),
  source: Source,
});

const DataWaffle = z.object({
  type: z.literal("data.waffle"),
  ...common,
  percent: z.number().int().min(0).max(100),
  label: z.string().min(1).max(80),
  sub: z.string().max(60).optional(),
  source: Source,
});

const DataTimeline = z.object({
  type: z.literal("data.timeline"),
  ...common,
  title: z.string().min(1).max(60),
  range: z.tuple([z.number().int(), z.number().int()]),
  /** placed at their real position in time; the last one is highlighted */
  events: z.array(z.object({ year: z.number().int(), text: z.string().min(1).max(44) })).min(2).max(7),
});

// ── energy ────────────────────────────────────────────────────────────────

const Cta = z.object({ button: z.string().min(1).max(20), text: z.string().max(40).optional() });

const EnergyPunch = z.object({
  type: z.literal("energy.punch"),
  ...common,
  context: z.string().max(70).optional(),
  /** 1–3 words, huge, tilted */
  punch: z.string().min(1).max(20),
  cta: Cta.optional(),
  /** blue for lessons, red for news */
  tone: z.enum(["blue", "red"]).optional(),
});

const EnergyPunch3d = z.object({
  type: z.literal("energy.punch-3d"),
  ...common,
  context: z.string().max(70).optional(),
  punch: z.string().min(1).max(20),
  cta: Cta.optional(),
  tone: z.enum(["blue", "red"]).optional(),
});

const EnergyMythFact = z.object({
  type: z.literal("energy.myth-fact"),
  ...common,
  myth: z.string().min(1).max(80),
  fact: z.string().min(1).max(100),
  keyword: Keyword.optional(),
  labels: z.tuple([z.string().min(1).max(16), z.string().min(1).max(16)]).optional(),
});

const Side = z.object({ value: z.string().min(1).max(12), sub: z.string().max(40).optional(), label: z.string().max(16).optional() });

const EnergyBeforeAfter = z.object({
  type: z.literal("energy.before-after"),
  ...common,
  label: z.string().max(60).optional(),
  before: Side,
  after: Side,
  multiplier: z.object({ value: z.string().min(1).max(5), sub: z.string().max(16).optional() }).optional(),
});

const EnergyBigRank = z.object({
  type: z.literal("energy.big-rank"),
  ...common,
  rank: z.number().int().min(1).max(99),
  total: z.number().int().min(1).max(99).optional(),
  /** "Lỗi" → "Lỗi 1 trên 3" */
  noun: z.string().max(12).optional(),
  title: z.string().min(1).max(60),
  detail: z.string().max(110).optional(),
  fix: z.string().max(60).optional(),
});

// ── 3d ────────────────────────────────────────────────────────────────────

export const MODELS = ["code-cube", "layers-stack", "phone"] as const;

const ThreeLayers = z.object({
  type: z.literal("3d.layers"),
  ...common,
  title: z.string().max(60).optional(),
  keyword: Keyword.optional(),
  /** top to bottom, e.g. Presentation, Domain, Data */
  layers: z
    .array(z.object({ name: z.string().min(1).max(16), items: z.array(z.string().min(1).max(18)).max(3).optional() }))
    .min(2)
    .max(4),
  /** 0-based index of the layer the others depend on (blue) */
  core: z.number().int().min(0).optional(),
  rule: z.string().max(60).optional(),
});

const ThreeHero = z.object({
  type: z.literal("3d.hero-object"),
  ...common,
  title: z.string().min(1).max(70),
  keyword: Keyword.optional(),
  subtitle: z.string().max(90).optional(),
  model: z.enum(MODELS).optional(),
  /** glyph on the cube's front face, default "{ }" */
  symbol: z.string().min(1).max(4).optional(),
});

const ThreePhone = z.object({
  type: z.literal("3d.phone"),
  ...common,
  title: z.string().min(1).max(50),
  keyword: Keyword.optional(),
  points: z.array(z.string().min(1).max(50)).max(3).optional(),
  /** screenshot; otherwise a mock app screen is drawn */
  image: Media.optional(),
  ui: z
    .object({ appBar: z.string().max(20).optional(), rows: z.number().int().min(0).max(6).optional(), button: z.string().max(24).optional() })
    .optional(),
});

export const TEMPLATE_SCENES = [
  LessonCompare,
  NewsBreaking, NewsTopN, NewsQuote, NewsLowerThird, NewsGlobe,
  DataBigNumber, DataDumbbell, DataLine, DataWaffle, DataTimeline,
  EnergyPunch, EnergyPunch3d, EnergyMythFact, EnergyBeforeAfter, EnergyBigRank,
  ThreeLayers, ThreeHero, ThreePhone,
] as const;

// ── cross-field checks ────────────────────────────────────────────────────

type Issue = { path: (string | number)[]; message: string };

/** Where each type's `keyword` must appear. */
const KEYWORD_IN: Record<string, string> = {
  title: "title", concept: "definition",
  "lesson.compare": "title", "news.breaking": "headline", "news.quote": "quote", "news.globe": "headline",
  "data.dumbbell": "title", "data.line": "title", "energy.myth-fact": "fact",
  "3d.layers": "title", "3d.hero-object": "title", "3d.phone": "title",
};

export function refineTemplateScene(s: Record<string, unknown> & { type: string }): Issue[] {
  const out: Issue[] = [];
  const field = KEYWORD_IN[s.type];
  if (field && typeof s.keyword === "string") {
    const text = String(s[field] ?? "");
    if (!text.includes(s.keyword)) out.push({ path: ["keyword"], message: `keyword "${s.keyword}" does not appear in ${field}` });
  }
  if (s.type === "data.line") {
    const pts = s.points as number[];
    const labels = s.labels as string[];
    if (labels.length !== pts.length) out.push({ path: ["labels"], message: `expected ${pts.length} labels, got ${labels.length}` });
    const a = s.annotation as { i: number } | undefined;
    if (a && a.i >= pts.length) out.push({ path: ["annotation", "i"], message: "annotation index out of range" });
  }
  if (s.type === "data.timeline") {
    const [a, b] = s.range as [number, number];
    if (b <= a) out.push({ path: ["range"], message: "range end must be after start" });
    (s.events as { year: number }[]).forEach((e, i) => {
      if (e.year < a || e.year > b) out.push({ path: ["events", i, "year"], message: `year ${e.year} outside range ${a}–${b}` });
    });
  }
  if (s.type === "data.dumbbell") {
    const max = s.axisMax as number;
    (s.rows as { a: number; b: number }[]).forEach((r, i) => {
      if (r.a > max || r.b > max || r.a < 0 || r.b < 0) out.push({ path: ["rows", i], message: `values must be within 0–${max} (axisMax)` });
    });
  }
  if (s.type === "3d.layers" && typeof s.core === "number" && s.core >= (s.layers as unknown[]).length) {
    out.push({ path: ["core"], message: "core layer index out of range" });
  }
  if ((s.type === "energy.punch" || s.type === "energy.punch-3d") && String(s.punch).trim().split(/\s+/).length > 3) {
    out.push({ path: ["punch"], message: "punch is 1–3 words" });
  }
  return out;
}
