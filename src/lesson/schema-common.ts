/**
 * Fields shared by every scene type (lesson script v2). Split out of schema.ts
 * so the template scene types (schema-templates.ts) can reuse them.
 */
import { z } from "zod";

export const TRANSITIONS = [
  "auto", "none", "fade", "push", "slide-up", "zoom", "wipe", "iris", "blinds", "blur", "glitch",
] as const;
export const Transition = z.enum(TRANSITIONS);
export type TransitionName = z.infer<typeof Transition>;

/** Icon reference: a Lucide name ("smartphone") or a brand logo ("si:kotlin"). */
export const Icon = z.string().regex(/^(si:)?[a-z0-9-]+$/, "icon must be a lucide name or si:<simple-icons slug>");

export const At = z.union([z.string().min(1), z.number().min(0)]);

export const SfxRef = z.object({
  /** cue name, "start" | "end", or seconds after the narration starts */
  at: At.default("start"),
  /** sound name from assets/sfx (see `npm run audio:catalog`) */
  name: z.string().min(1),
  volume: z.number().min(0).max(1).optional(),
});

export const BEAT_ACTIONS = [
  "reveal", "focus", "show", "highlight", "flow", "tap", "check", "type", "zoom",
] as const;

export const Beat = z.object({
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
export const MascotRef = z.union([
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

export const common = {
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
