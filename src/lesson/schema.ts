/**
 * Lesson script v2 — the contract between the `create-lesson-video` skill
 * (creative, LLM-authored) and the deterministic lesson pipeline.
 *
 * Shape: lesson meta → chapters → scenes. Every scene has a `voice` narration
 * that may carry inline markers the pipeline strips before TTS:
 *   {1} {2} …           reveal list item n when the narrator reaches this word
 *   {L3} {L3-5,8}       focus code lines (code scenes)
 *   {show:api} {hl:db}  show / highlight a diagram node, layer, column…
 *   {flow:app>api>db}   send a packet along diagram edges
 *   {tap:1}             tap callout n on a phone screen
 *   {answer}            reveal the quiz answer
 *   {pause:4}           insert 4s of silence (quiz countdown, "try it yourself")
 *   {anyName}           plain named cue, referenced by `beats[].at`
 */
import { z } from "zod";

export const FORMATS = ["landscape", "portrait"] as const;
export const Format = z.enum(FORMATS);
export type FormatName = z.infer<typeof Format>;

export const TRANSITIONS = [
  "auto", "none", "fade", "push", "slide-up", "zoom", "wipe", "iris", "blinds", "blur", "glitch",
] as const;
export const Transition = z.enum(TRANSITIONS);
export type TransitionName = z.infer<typeof Transition>;

/** Icon reference: a Lucide name ("smartphone") or a brand logo ("si:kotlin"). */
const Icon = z.string().regex(/^(si:)?[a-z0-9-]+$/, "icon must be a lucide name or si:<simple-icons slug>");

const At = z.union([z.string().min(1), z.number().min(0)]);

const SfxRef = z.object({
  /** cue name, "start" | "end", or seconds after the narration starts */
  at: At.default("start"),
  /** sound name from assets/sfx (see `npm run audio:catalog`) */
  name: z.string().min(1),
  volume: z.number().min(0).max(1).optional(),
});

export const BEAT_ACTIONS = [
  "reveal", "focus", "show", "highlight", "flow", "tap", "check", "type", "zoom",
] as const;

const Beat = z.object({
  at: At,
  do: z.enum(BEAT_ACTIONS),
  /** item index (1-based), node/layer id, column index… depends on the scene */
  target: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
  /** code line spec: "3", "3-5", "3-5,8" */
  lines: z.string().optional(),
  /** diagram node ids for a `flow` packet */
  path: z.array(z.string()).optional(),
  /** short annotation shown next to the focused element */
  note: z.string().max(90).optional(),
  /** sound for this beat (overrides the style default); false = silent */
  sfx: z.union([z.string(), z.literal(false)]).optional(),
});
export type BeatSpec = z.infer<typeof Beat>;

export const MASCOT_POSES = ["idle", "wave", "point", "think", "celebrate"] as const;
export type MascotPose = (typeof MASCOT_POSES)[number];

/** brand mascot in this scene: false = hide, a pose name, or pose + side + speech bubble */
const MascotRef = z.union([
  z.literal(false),
  z.enum(MASCOT_POSES),
  z.object({
    pose: z.enum(MASCOT_POSES).default("point"),
    /** screen corner; default right (landscape) / left (portrait) */
    side: z.enum(["left", "right"]).optional(),
    /** short speech bubble */
    say: z.string().min(1).max(48).optional(),
    /** mouth moves with the narration (default true) */
    talk: z.boolean().optional(),
  }),
]);
export type MascotRefSpec = z.infer<typeof MascotRef>;

const common = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id: lowercase letters, digits, dashes").optional(),
  /** brand mascot (see MascotRef); intro, quiz and outro get one automatically */
  mascot: MascotRef.optional(),
  /** narration (Vietnamese), may contain {markers} — see file header */
  voice: z.string().min(1),
  beats: z.array(Beat).optional(),
  /** transition INTO this scene; "auto" lets the style decide */
  transition: Transition.optional(),
  sfx: z.array(SfxRef).optional(),
  /** seconds to hold after the narration ends (default from style) */
  hold: z.number().min(0).max(8).optional(),
};

const ListItem = z.union([
  z.string().min(1).max(110),
  z.object({
    text: z.string().min(1).max(110),
    sub: z.string().max(100).optional(),
    icon: Icon.optional(),
  }),
]);
export type ListItemSpec = z.infer<typeof ListItem>;

const Statement = z.object({
  type: z.literal("statement"),
  ...common,
  text: z.string().min(1).max(110),
  sub: z.string().max(140).optional(),
  tag: z.string().max(28).optional(),
  icon: Icon.optional(),
  /** words/phrases inside `text` to mark with the accent highlighter */
  emphasis: z.array(z.string().min(1)).max(4).optional(),
});

const Title = z.object({
  type: z.literal("title"),
  ...common,
  title: z.string().min(1).max(90),
  subtitle: z.string().max(140).optional(),
  kicker: z.string().max(48).optional(),
  icons: z.array(Icon).max(4).optional(),
});

const Objectives = z.object({
  type: z.literal("objectives"),
  ...common,
  title: z.string().max(60).optional(),
  items: z.array(z.string().min(1).max(90)).min(2).max(5),
});

const Concept = z.object({
  type: z.literal("concept"),
  ...common,
  term: z.string().min(1).max(48),
  definition: z.string().min(1).max(200),
  tag: z.string().max(28).optional(),
  icon: Icon.optional(),
  example: z.string().max(140).optional(),
});

const Bullets = z.object({
  type: z.literal("bullets"),
  ...common,
  title: z.string().min(1).max(70),
  items: z.array(ListItem).min(1).max(6),
  numbered: z.boolean().optional(),
  layout: z.enum(["list", "grid"]).optional(),
});

const Code = z.object({
  type: z.literal("code"),
  ...common,
  title: z.string().max(70).optional(),
  filename: z.string().max(48).optional(),
  lang: z.string().min(1).max(24),
  code: z.string().min(1).max(2400),
  /** lines focused before any cue, e.g. "3-5" */
  focus: z.string().optional(),
  /** type the code in (default true for ≤ 14 lines) */
  typing: z.boolean().optional(),
});

const Diff = z.object({
  type: z.literal("diff"),
  ...common,
  title: z.string().max(70).optional(),
  filename: z.string().max(48).optional(),
  lang: z.string().min(1).max(24),
  before: z.string().min(1).max(1400),
  after: z.string().min(1).max(1400),
});

const Terminal = z.object({
  type: z.literal("terminal"),
  ...common,
  title: z.string().max(70).optional(),
  commands: z
    .array(z.object({ cmd: z.string().min(1).max(140), output: z.string().max(600).optional() }))
    .min(1)
    .max(5),
});

export const NODE_KINDS = [
  "mobile", "web", "client", "user", "api", "gateway", "server", "service", "function",
  "db", "cache", "queue", "storage", "cloud", "auth", "ai", "external", "module",
] as const;

const Diagram = z.object({
  type: z.literal("diagram"),
  ...common,
  title: z.string().max(70).optional(),
  direction: z.enum(["auto", "LR", "TB"]).optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
        label: z.string().min(1).max(26),
        sub: z.string().max(30).optional(),
        kind: z.enum(NODE_KINDS).optional(),
        icon: Icon.optional(),
      }),
    )
    .min(2)
    .max(9),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().max(22).optional(),
        dashed: z.boolean().optional(),
      }),
    )
    .max(14)
    .default([]),
  /** reveal nodes one by one with the narration (default: all visible) */
  progressive: z.boolean().optional(),
});

const Layers = z.object({
  type: z.literal("layers"),
  ...common,
  title: z.string().max(70).optional(),
  mode: z.enum(["stack", "onion"]).optional(),
  layers: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).optional(),
        name: z.string().min(1).max(26),
        items: z.array(z.string().min(1).max(26)).max(4).optional(),
        note: z.string().max(50).optional(),
      }),
    )
    .min(2)
    .max(5),
  /** label for the dependency arrow, e.g. "Phụ thuộc hướng vào trong" */
  rule: z.string().max(60).optional(),
  /**
   * stack mode: 0-based index of the core layer every other layer depends on
   * (Clean Architecture: Presentation → Domain ← Data ⇒ core = 1).
   * Without it, arrows point from each layer to the one below.
   */
  core: z.number().int().min(0).optional(),
});

const Phone = z.object({
  type: z.literal("phone"),
  ...common,
  title: z.string().max(70).optional(),
  platform: z.enum(["android", "ios"]).optional(),
  /** screenshot path (relative to the script) or URL; else `ui` mock is drawn */
  image: z.string().optional(),
  ui: z
    .object({
      appBar: z.string().max(28).optional(),
      items: z
        .array(z.object({ title: z.string().max(34), sub: z.string().max(40).optional(), icon: Icon.optional() }))
        .max(6)
        .optional(),
      button: z.string().max(26).optional(),
      toast: z.string().max(40).optional(),
      state: z.enum(["content", "loading", "error", "empty"]).optional(),
    })
    .optional(),
  /** labels pointing at screen regions (x/y in % of the screen) */
  callouts: z
    .array(z.object({ text: z.string().min(1).max(40), x: z.number().min(0).max(100), y: z.number().min(0).max(100) }))
    .max(4)
    .optional(),
  /** optional bullet points beside the phone (landscape) / below it (portrait) */
  points: z.array(z.string().min(1).max(70)).max(4).optional(),
});

const Compare = z.object({
  type: z.literal("compare"),
  ...common,
  title: z.string().max(70).optional(),
  columns: z.array(z.string().min(1).max(24)).min(2).max(3),
  rows: z
    .array(
      z.object({
        label: z.string().min(1).max(32),
        values: z.array(z.union([z.string().max(34), z.boolean()])),
      }),
    )
    .min(1)
    .max(6),
  /** 0-based column to crown at the end */
  winner: z.number().int().min(0).optional(),
});

const Quiz = z.object({
  type: z.literal("quiz"),
  ...common,
  question: z.string().min(1).max(130),
  options: z.array(z.string().min(1).max(70)).min(2).max(4),
  answer: z.number().int().min(0),
  explain: z.string().max(140).optional(),
});

const Recap = z.object({
  type: z.literal("recap"),
  ...common,
  title: z.string().max(60).optional(),
  items: z.array(z.string().min(1).max(90)).min(2).max(6),
});

const ImageScene = z.object({
  type: z.literal("image"),
  ...common,
  src: z.string().min(1),
  title: z.string().max(70).optional(),
  caption: z.string().max(120).optional(),
  fit: z.enum(["cover", "contain"]).optional(),
  motion: z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right", "none"]).optional(),
});

export const SceneSchema = z.discriminatedUnion("type", [
  Statement, Title, Objectives, Concept, Bullets, Code, Diff, Terminal,
  Diagram, Layers, Phone, Compare, Quiz, Recap, ImageScene,
]);
export type SceneSpec = z.infer<typeof SceneSchema>;
export type SceneType = SceneSpec["type"];
export type SceneOf<T extends SceneType> = Extract<SceneSpec, { type: T }>;

const Chapter = z.object({
  title: z.string().min(1).max(60),
  /** optional narration read over the chapter card */
  voice: z.string().optional(),
  /** show a chapter card (default: true when the lesson has > 1 chapter) */
  card: z.boolean().optional(),
  scenes: z.array(SceneSchema).min(1),
});
export type ChapterSpec = z.infer<typeof Chapter>;

export const LessonScriptSchema = z
  .object({
    version: z.literal("2.0"),
    lesson: z.object({
      title: z.string().min(1).max(90),
      subtitle: z.string().max(140).optional(),
      series: z.string().max(60).optional(),
      episode: z.number().int().min(1).optional(),
      level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
      tags: z.array(z.string()).max(8).optional(),
    }),
    brand: z.string().default("dan-tech-academy"),
    /** "auto": brand mascot on intro, quiz, outro + scenes that ask for it; "off": never */
    mascot: z.enum(["auto", "off"]).default("auto"),
    /** style pack id (src/lesson/styles/<id>), default from the brand */
    style: z.string().optional(),
    formats: z.array(Format).min(1).default(["landscape"]),
    voice: z
      .object({
        /** "free" = Edge TTS, "clone" = cloned instructor voice (ElevenLabs/LucyLab) */
        profile: z.enum(["free", "clone"]).optional(),
        provider: z.enum(["edge-tts", "elevenlabs", "lucylab", "vbee"]).optional(),
        voiceId: z.string().optional(),
        /** Edge rate like "-5%"; ElevenLabs speed 0.7–1.2 */
        rate: z.union([z.string(), z.number()]).optional(),
        /** lexicon id in assets/lexicon, or false to disable */
        lexicon: z.union([z.string(), z.literal(false)]).optional(),
      })
      .default({}),
    /** background music: a name from assets/music, or "none" */
    music: z
      .union([
        z.literal("none"),
        z.object({
          track: z.string().min(1),
          volume: z.number().min(0).max(1).optional(),
          duck: z.boolean().optional(),
        }),
      ])
      .optional(),
    captions: z
      .object({ burn: z.union([z.boolean(), z.literal("auto")]).default("auto") })
      .default({ burn: "auto" }),
    /** brand intro sting: "auto" = after the first scene in landscape, none in portrait */
    intro: z.union([z.enum(["auto", "start", "after-first", "none"])]).default("auto"),
    outro: z
      .object({
        next: z.string().max(90).optional(),
        voice: z.string().optional(),
        enabled: z.boolean().default(true),
      })
      .default({ enabled: true }),
    chapters: z.array(Chapter).min(1),
  })
  .superRefine((script, ctx) => {
    const ids = new Set<string>();
    script.chapters.forEach((ch, ci) =>
      ch.scenes.forEach((s, si) => {
        const path = ["chapters", ci, "scenes", si];
        if (s.id) {
          if (ids.has(s.id)) ctx.addIssue({ code: "custom", path: [...path, "id"], message: `duplicate scene id "${s.id}"` });
          ids.add(s.id);
        }
        if (s.type === "quiz" && s.answer >= s.options.length) {
          ctx.addIssue({ code: "custom", path: [...path, "answer"], message: `answer ${s.answer} >= options.length ${s.options.length}` });
        }
        if (s.type === "diagram") {
          const nodeIds = new Set(s.nodes.map((n) => n.id));
          if (nodeIds.size !== s.nodes.length) ctx.addIssue({ code: "custom", path: [...path, "nodes"], message: "duplicate node id" });
          s.edges.forEach((e, ei) => {
            for (const end of [e.from, e.to]) {
              if (!nodeIds.has(end)) ctx.addIssue({ code: "custom", path: [...path, "edges", ei], message: `edge references unknown node "${end}"` });
            }
          });
        }
        if (s.type === "compare") {
          s.rows.forEach((r, ri) => {
            if (r.values.length !== s.columns.length) {
              ctx.addIssue({ code: "custom", path: [...path, "rows", ri, "values"], message: `expected ${s.columns.length} values, got ${r.values.length}` });
            }
          });
          if (s.winner !== undefined && s.winner >= s.columns.length) {
            ctx.addIssue({ code: "custom", path: [...path, "winner"], message: "winner column out of range" });
          }
        }
        if (s.type === "phone" && !s.image && !s.ui) {
          ctx.addIssue({ code: "custom", path, message: "phone scene needs `image` or `ui`" });
        }
      }),
    );
  });

export type LessonScript = z.infer<typeof LessonScriptSchema>;
