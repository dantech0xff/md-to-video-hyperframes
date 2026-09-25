/** Scene renderers for the template families (types with a dot: "news.breaking"). */
import type { PlannedScene } from "../plan.js";
import type { Ctx, Rendered } from "../compose-kit.js";
import { LESSON_TEMPLATES } from "./lesson.js";
import { NEWS_TEMPLATES } from "./news.js";
import { DATA_TEMPLATES } from "./data.js";
import { ENERGY_TEMPLATES } from "./energy.js";
import { THREE_TEMPLATES } from "./three.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TemplateRenderer = (s: any, scene: PlannedScene, ctx: Ctx) => Rendered | Promise<Rendered>;

export const TEMPLATE_RENDERERS: Record<string, TemplateRenderer> = {
  ...LESSON_TEMPLATES,
  ...NEWS_TEMPLATES,
  ...DATA_TEMPLATES,
  ...ENERGY_TEMPLATES,
  ...THREE_TEMPLATES,
};
