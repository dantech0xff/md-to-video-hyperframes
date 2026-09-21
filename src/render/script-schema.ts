import { z } from "zod";

// ── Template data shapes (discriminated by template field) ─────────────────

const HookData = z.object({
  template: z.literal("hook"),
  headline: z.string().min(1).max(40),
  subhead: z.string().max(40).optional(),
  /** background image path (literal "$source.image" → substituted at pipeline level) */
  bgSrc: z.string().optional(),
  /** Ken Burns effect class */
  kenBurns: z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right"]).default("zoom-in"),
});

const ComparisonSide = z.object({
  label: z.string().min(1).max(30),
  value: z.string().min(1).max(20),
  color: z.enum(["cyan", "purple"]),
});

const ComparisonData = z.object({
  template: z.literal("comparison"),
  left: ComparisonSide,
  right: ComparisonSide.extend({ winner: z.boolean().optional() }),
});

const StatHeroData = z.object({
  template: z.literal("stat-hero"),
  value: z.string().min(1).max(20),
  label: z.string().min(1).max(40),
  context: z.string().max(50).optional(),
});

const FeatureListData = z.object({
  template: z.literal("feature-list"),
  title: z.string().min(1).max(40),
  bullets: z.array(z.string().min(1).max(50)).min(1).max(4),
  icon: z.string().optional(),
});

const CalloutData = z.object({
  template: z.literal("callout"),
  statement: z.string().min(1).max(80),
  tag: z.string().max(20).optional(),
});

const OutroData = z.object({
  template: z.literal("outro"),
  ctaTop: z.string().min(1).max(30),
  channelName: z.string().min(1).max(30),
  source: z.string().min(1).max(40),
});

// ── Educator templates ────────────────────────────────────────────────────

/** Term → definition card ("Khái niệm") — core of any lesson video. */
const DefinitionData = z.object({
  template: z.literal("definition"),
  term: z.string().min(1).max(40),
  definition: z.string().min(1).max(160),
  tag: z.string().max(20).optional(),
});

/** Numbered process / how-to steps. */
const StepsData = z.object({
  template: z.literal("steps"),
  title: z.string().min(1).max(40),
  items: z.array(z.string().min(1).max(80)).min(1).max(5),
});

/** Chronological events on a vertical rail. */
const TimelineEvent = z.object({
  marker: z.string().min(1).max(14),
  text: z.string().min(1).max(70),
});
const TimelineData = z.object({
  template: z.literal("timeline"),
  title: z.string().min(1).max(40),
  events: z.array(TimelineEvent).min(2).max(5),
});

/** Multiple-choice question; `answerIndex` option gets highlighted on reveal. */
const QuizData = z.object({
  template: z.literal("quiz"),
  question: z.string().min(1).max(100),
  options: z.array(z.string().min(1).max(50)).min(2).max(4),
  answerIndex: z.number().int().min(0),
});
// NOTE: answerIndex bounds (< options.length) are enforced on ScriptSchema
// (see .superRefine below) — Zod .refine() on QuizData would wrap the object
// and break the discriminated union above.

/** Misconception vs correction — great for "common mistakes" segments. */
const MythFactData = z.object({
  template: z.literal("myth-fact"),
  myth: z.string().min(1).max(90),
  fact: z.string().min(1).max(90),
});

/** Big takeaway moment ("Ghi nhớ") — cardless hero statement. */
const KeyPointData = z.object({
  template: z.literal("key-point"),
  point: z.string().min(1).max(100),
  tag: z.string().max(20).optional(),
});

/** Formula / code block with caption — math, physics, programming lessons. */
const FormulaData = z.object({
  template: z.literal("formula"),
  formula: z.string().min(1).max(60),
  caption: z.string().min(1).max(80),
  label: z.string().max(20).optional(),
});

/** Chapter / section divider — "PHẦN 2" + topic title. */
const ChapterData = z.object({
  template: z.literal("chapter"),
  number: z.string().min(1).max(20),
  title: z.string().min(1).max(50),
});

export const TemplateData = z.discriminatedUnion("template", [
  HookData,
  ComparisonData,
  StatHeroData,
  FeatureListData,
  CalloutData,
  OutroData,
  DefinitionData,
  StepsData,
  TimelineData,
  QuizData,
  MythFactData,
  KeyPointData,
  FormulaData,
  ChapterData,
]);

export type TemplateDataType = z.infer<typeof TemplateData>;

// ── SFX schema ─────────────────────────────────────────────────────────────
/**
 * Per-scene sound effect override. If omitted, the pipeline picks a default
 * SFX based on the template type (see SKILL.md / pipeline DEFAULT_SFX).
 *
 * `name` examples: "transition/whoosh-soft", "emphasis/ding", "alert/notification"
 *   → resolves to assets/sfx/<name>.mp3
 * Set `name: "none"` to explicitly disable SFX for this scene.
 */
const SfxSpec = z.object({
  name: z.string().min(1),
  /** Volume 0–1, default 0.4 (so SFX doesn't drown the voice) */
  volume: z.number().min(0).max(1).default(0.4),
  /** Seconds offset from scene start (default 0). Negative = before scene. */
  startOffsetSec: z.number().default(0),
});

export type SfxSpecType = z.infer<typeof SfxSpec>;

// ── Scene schema ───────────────────────────────────────────────────────────

const Scene = z.object({
  id: z.string().min(1),
  type: z.enum(["hook", "body", "outro"]),
  voiceText: z.string().min(1),
  templateData: TemplateData,
  /** Optional sound effect override (else pipeline picks per template) */
  sfx: SfxSpec.optional(),
});

// ── Root schema ────────────────────────────────────────────────────────────

export const ScriptSchema = z.object({
  version: z.literal("1.0"),
  metadata: z.object({
    title: z.string().min(1),
    source: z.object({
      url: z.string(),
      domain: z.string(),
      image: z.string().url().nullable(),
    }),
    channel: z.string().min(1),
  }),
  voice: z.object({
    provider: z.string().min(1),
    voiceId: z.string().min(1),
    speed: z.number().min(0.5).max(2.0),
  }),
  scenes: z
    .array(Scene)
    .min(5)
    .max(8, "scenes must have at most 8 items")
    .refine(
      (s) => s[0]?.type === "hook",
      { message: "scenes[0] must be type=hook" }
    )
    .refine(
      (s) => s[s.length - 1]?.type === "outro",
      { message: "last scene must be type=outro" }
    )
    // cross-field check lives here (not on QuizData) so TemplateData can stay
    // a discriminated union — and it fails before any TTS quota is spent
    .superRefine((scenes, ctx) => {
      scenes.forEach((scene, i) => {
        const td = scene.templateData;
        if (td.template === "quiz" && td.answerIndex >= td.options.length) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", i, "templateData", "answerIndex"],
            message: `quiz answerIndex ${td.answerIndex} >= options.length ${td.options.length}`,
          });
        }
      });
    }),
});

export type Script = z.infer<typeof ScriptSchema>;
