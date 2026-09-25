/**
 * news.*: dark Dan Tech with a red accent, a category tag top-left, the
 * NEWS tag beside the logo (shell) and an optional crawling ticker.
 * Breaking news never shows a date.
 */
import type { SceneOf } from "../schema.js";
import type { PlannedScene } from "../plan.js";
import { type Ctx, type Rendered, withKeyword, tickerBar, useAsset } from "../compose-kit.js";
import { esc, inline } from "../markup.js";
import type { TemplateRenderer } from "./index.js";

/** Category tag. `hot` = filled red with a white dot (breaking); otherwise dark with red text. */
export const newsTag = (label: string, hot: boolean, cls = "") =>
  `<span class="news-tag${hot ? " is-hot" : ""} ${cls}">${hot ? '<span class="news-dot"></span>' : ""}${esc(label)}</span>`;

const ticker = (s: { ticker?: string[]; tickerLabel?: string }) => (s.ticker?.length ? tickerBar(s.ticker, s.tickerLabel ?? "CẬP NHẬT") : "");

async function media(ctx: Ctx, src: string | undefined, cls: string): Promise<string> {
  if (!src) return "";
  const rel = await useAsset(ctx, src);
  return `<div class="${cls}"><img src="${esc(rel)}" alt=""></div>`;
}

async function renderBreaking(s: SceneOf<"news.breaking">, _scene: PlannedScene, ctx: Ctx): Promise<Rendered> {
  const label = s.label ?? "TIN NÓNG";
  const facts = s.facts?.length ? `<div class="news-facts">${s.facts.map((f, i) => `<span class="news-fact" data-item="${i + 1}">${inline(f)}</span>`).join("")}</div>` : "";
  const image = await media(ctx, s.image, "news-image");
  const text = `
    <div class="news-body">
      ${ctx.portrait ? newsTag(label, true) : ""}
      <h1 class="news-headline" data-split>${withKeyword(s.headline, s.keyword)}</h1>
      ${s.sub ? `<p class="news-sub">${inline(s.sub)}</p>` : ""}
      ${ctx.portrait && image ? "" : facts}
    </div>`;
  return {
    html: `
${ctx.portrait ? "" : `<div class="news-top">${newsTag(label, true)}</div>`}
<div class="content content--breaking${image ? " has-image" : ""}">
  ${ctx.portrait ? image + text : text + image}
</div>
${ticker(s)}`,
    meta: { facts: s.facts?.length ?? 0 },
  };
}

function renderTopN(s: SceneOf<"news.top-n">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const label = s.label ?? "BẢN TIN TUẦN";
  const items = s.items
    .map((it, i) => {
      const meta = [it.source, it.time].filter(Boolean).join(", ");
      const num = String(i + 1).padStart(2, "0");
      const body = ctx.portrait
        ? `<div class="topn-text"><span class="topn-title">${inline(it.title)}</span>${meta ? `<span class="topn-meta">${esc(meta)}</span>` : ""}</div>`
        : `<span class="topn-title">${inline(it.title)}</span>${meta ? `<span class="topn-meta">${esc(meta)}</span>` : ""}`;
      return `<div class="topn-item${i === 0 ? " is-first" : ""}" data-item="${i + 1}"><span class="topn-num">${num}</span>${body}</div>`;
    })
    .join("");
  const head = ctx.portrait
    ? `<div class="topn-kicker">${esc([label, s.period].filter(Boolean).join(", "))}</div>`
    : "";
  return {
    html: `
${ctx.portrait ? "" : `<div class="news-top">${newsTag(label, false)}${s.period ? `<span class="news-period">${esc(s.period)}</span>` : ""}</div>`}
<div class="content content--topn">
  ${head}
  <h2 class="topn-heading">${inline(s.title)}</h2>
  <div class="topn-list">${items}</div>
</div>
${ticker(s)}`,
    meta: { items: s.items.length },
  };
}

async function renderQuote(s: SceneOf<"news.quote">, _scene: PlannedScene, ctx: Ctx): Promise<Rendered> {
  const label = s.label ?? "PHÁT BIỂU";
  let avatar = `<div class="quote-avatar is-empty">${esc(s.person.split(/\s+/).map((w) => w[0]).slice(-2).join("").toUpperCase())}</div>`;
  if (s.avatar) avatar = `<div class="quote-avatar" style="background-image:url('${esc(await useAsset(ctx, s.avatar))}')"></div>`;
  const tick = ctx.portrait ? ticker(s) : tickerBar(s.ticker?.length ? s.ticker : [s.source], s.ticker?.length ? s.tickerLabel ?? "CẬP NHẬT" : "NGUỒN");
  return {
    html: `
${ctx.portrait ? "" : `<div class="news-top">${newsTag(label, false)}</div>`}
<div class="content content--quote">
  <div class="quote-mark" aria-hidden="true">“</div>
  <blockquote class="quote-text" data-split>${withKeyword(s.quote, s.keyword)}</blockquote>
  <div class="quote-person">${avatar}<div class="quote-who"><span class="quote-name">${inline(s.person)}</span>${s.role ? `<span class="quote-role">${inline(s.role)}</span>` : ""}</div></div>
  ${ctx.portrait ? `<div class="quote-source">Nguồn: ${inline(s.source)}</div>` : ""}
</div>
${tick}`,
  };
}

async function renderLowerThird(s: SceneOf<"news.lower-third">, _scene: PlannedScene, ctx: Ctx): Promise<Rendered> {
  const rel = await useAsset(ctx, s.media);
  return {
    bg: `<div class="lt-media"><img src="${esc(rel)}" alt=""></div><div class="lt-shade"></div>`,
    html: `
<div class="lt-plate">
  <span class="lt-tag">${esc(s.tag)}</span>
  <div class="lt-box"><span class="lt-name">${inline(s.name)}</span>${s.role ? `<span class="lt-role">${inline(s.role)}</span>` : ""}</div>
</div>`,
  };
}

export const NEWS_TEMPLATES: Record<string, TemplateRenderer> = {
  "news.breaking": renderBreaking,
  "news.top-n": renderTopN,
  "news.quote": renderQuote,
  "news.lower-third": renderLowerThird,
};
