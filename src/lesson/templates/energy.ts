/**
 * energy.*: pattern interrupts. punch / before-after are full-bleed accent
 * scenes; myth-fact and big-rank sit on the lesson background.
 */
import type { SceneOf } from "../schema.js";
import type { PlannedScene } from "../plan.js";
import { type Ctx, type Rendered, withKeyword } from "../compose-kit.js";
import { esc, inline } from "../markup.js";
import type { TemplateRenderer } from "./index.js";

type Cta = { button: string; text?: string } | undefined;

export const ctaRow = (cta: Cta) =>
  cta ? `<div class="punch-cta"><span class="punch-btn">${esc(cta.button)}</span>${cta.text ? `<span>${inline(cta.text)}</span>` : ""}</div>` : "";

/** The punch words; in 9:16 each word gets its own line. */
export const punchWords = (punch: string, portrait: boolean) =>
  portrait ? punch.trim().split(/\s+/).map(esc).join("<br>") : esc(punch.trim());

export const punchBg = (tone: string) => `<div class="punch-bg" data-tone="${tone}"></div>`;

function renderPunch(s: SceneOf<"energy.punch">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const tone = s.tone ?? "blue";
  return {
    bg: punchBg(tone),
    html: `
<div class="punch" data-tone="${tone}">
  ${s.context ? `<div class="punch-context">${inline(s.context)}</div>` : ""}
  <div class="punch-word">${punchWords(s.punch, ctx.portrait)}</div>
  ${ctaRow(s.cta)}
</div>`,
  };
}

function renderMythFact(s: SceneOf<"energy.myth-fact">, scene: PlannedScene): Rendered {
  const [myth, fact] = s.labels ?? ["Lầm tưởng", "Sự thật"];
  return {
    html: `
<div class="content content--mythfact">
  <div class="mf-tag"><span class="mf-pill is-myth">${esc(myth)}</span></div>
  <div class="mf-myth"><span class="mf-myth-text">${inline(s.myth)}</span><span class="mf-strike"></span></div>
  <div class="mf-gap"></div>
  <div class="mf-tag mf-tag--fact"><span class="mf-pill is-fact">${esc(fact)}</span></div>
  <div class="mf-fact" data-split>${withKeyword(s.fact, s.keyword, "mf-kw")}</div>
</div>`,
    meta: { factAt: scene.cues.fact ?? null },
  };
}

function renderBeforeAfter(s: SceneOf<"energy.before-after">, scene: PlannedScene): Rendered {
  const side = (cls: string, x: { value: string; sub?: string; label?: string }, def: string) =>
    `<div class="ba-side ${cls}"><span class="ba-label">${esc(x.label ?? def)}</span><span class="ba-value" data-count>${esc(x.value)}</span>${x.sub ? `<span class="ba-sub">${inline(x.sub)}</span>` : ""}</div>`;
  return {
    bg: `<div class="ba-half ba-half--before"></div><div class="ba-half ba-half--after"></div>`,
    html: `
${s.label ? `<div class="ba-title">${inline(s.label)}</div>` : ""}
${side("ba-before", s.before, "Trước")}
${side("ba-after", s.after, "Sau")}
${s.multiplier ? `<div class="ba-badge"><span class="ba-badge-v">${esc(s.multiplier.value)}</span>${s.multiplier.sub ? `<span class="ba-badge-sub">${esc(s.multiplier.sub)}</span>` : ""}</div>` : ""}`,
    meta: { afterAt: scene.cues.after ?? null },
  };
}

function renderBigRank(s: SceneOf<"energy.big-rank">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const of = `${s.noun ?? "Mục"} ${s.rank}${s.total ? ` trên ${s.total}` : ""}`;
  return {
    html: `
<div class="rank-num" aria-hidden="true">${s.rank}</div>
<div class="content content--rank">
  <span class="rank-of">${esc(of)}</span>
  <h2 class="rank-title" data-split>${inline(s.title)}</h2>
  ${s.detail ? `<p class="rank-detail">${inline(s.detail)}</p>` : ""}
  ${s.fix && !ctx.portrait ? `<div class="rank-fix"><span>Sửa: ${inline(s.fix)}</span></div>` : ""}
</div>`,
  };
}

export const ENERGY_TEMPLATES: Record<string, TemplateRenderer> = {
  "energy.punch": renderPunch,
  "energy.myth-fact": renderMythFact,
  "energy.before-after": renderBeforeAfter,
  "energy.big-rank": renderBigRank,
};
