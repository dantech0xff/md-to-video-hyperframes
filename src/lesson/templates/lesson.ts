/** lesson.compare: two cards side by side; the side with a badge is the recommended one. */
import type { SceneOf } from "../schema.js";
import type { Ctx, Rendered } from "../compose-kit.js";
import { esc, inline } from "../markup.js";
import { sceneTitle } from "../compose-kit.js";
import type { TemplateRenderer } from "./index.js";

type Side = SceneOf<"lesson.compare">["left"];

function card(side: Side, which: "left" | "right"): string {
  const rows = side.rows
    .map(
      (r, i) =>
        `<div class="vs-row" data-item="${i + 1}"><span class="vs-label">${inline(r.label)}</span><span class="vs-value" data-tone="${r.tone ?? "neutral"}">${inline(r.value)}</span></div>`,
    )
    .join("");
  return `
    <div class="vs-card${side.badge ? " is-pick" : ""}" data-side="${which}">
      <div class="vs-head"><span class="vs-name">${inline(side.name)}</span>${side.badge ? `<span class="vs-badge">${esc(side.badge)}</span>` : ""}</div>
      ${rows}
    </div>`;
}

function renderCompare(s: SceneOf<"lesson.compare">, _scene: unknown, _ctx: Ctx): Rendered {
  return {
    html: `
<div class="content content--vs">
  ${sceneTitle(s.title, s.keyword)}
  <div class="vs">${card(s.left, "left")}${card(s.right, "right")}</div>
</div>`,
    meta: { rows: Math.max(s.left.rows.length, s.right.rows.length) },
  };
}

export const LESSON_TEMPLATES: Record<string, TemplateRenderer> = {
  "lesson.compare": renderCompare,
};
