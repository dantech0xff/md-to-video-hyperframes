/**
 * 3D templates. Each scene gets a transparent three.js canvas between its
 * background and its HTML content (runtime/templates/50-three.js builds the
 * models in code and renders them from the GSAP timeline). All copy stays in
 * HTML; only energy.punch-3d puts its 1–3 words into 3D.
 *
 * Placement is given in frame pixels (the design sheet's coordinates); the
 * runtime maps pixels to world units at the model's depth.
 */
import type { SceneOf } from "../schema.js";
import type { PlannedScene } from "../plan.js";
import { type Ctx, type Rendered, withKeyword, tickerBar, useAsset } from "../compose-kit.js";
import { esc, inline } from "../markup.js";
import { newsTag } from "./news.js";
import { ctaRow, punchBg } from "./energy.js";
import { hasTicker } from "../families.js";
import type { TemplateRenderer } from "./index.js";

const FRAME = { landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 1920 } };

/** the canvas layer + optional HTML labels that follow projected 3D points */
function layer(ctx: Ctx, kind: string, labels = ""): string {
  const { w, h } = FRAME[ctx.format];
  return `<div class="three-layer" data-three="${kind}"><canvas class="three-canvas" width="${w}" height="${h}"></canvas>${labels ? `<div class="three-labels">${labels}</div>` : ""}</div>`;
}

function renderLayers(s: SceneOf<"3d.layers">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const P = ctx.portrait;
  const core = s.core ?? Math.min(1, s.layers.length - 1);
  const cards = s.layers
    .map((l, i) => {
      const items = l.items ?? [];
      const body = P
        ? `<span class="l3-sub">${esc(items.slice(0, 2).join(", "))}</span>`
        : `<div class="l3-chips">${items.map((it) => `<span class="l3-chip">${esc(it)}</span>`).join("")}</div>`;
      return `<div class="l3-card${i === core ? " is-core" : ""}" data-item="${i + 1}"><span class="l3-name">${inline(l.name)}</span>${items.length ? body : ""}</div>`;
    })
    .join("");
  const plates = s.layers
    .map((l, i) => `<div class="l3-plate-label" data-plate="${i}"><span class="l3-plate-name">${inline(l.name)}</span>${l.items?.length ? `<span class="l3-plate-sub">${esc(l.items.slice(-2).join(", "))}</span>` : ""}</div>`)
    .join("");
  return {
    html: `
${layer(ctx, "layers", plates)}
${s.title ? `<h2 class="l3-title">${withKeyword(s.title, s.keyword)}</h2>` : ""}
<div class="l3-cards">${cards}${s.rule && !P ? `<span class="l3-rule">${inline(s.rule)}</span>` : ""}</div>`,
    meta: {
      three: {
        model: "layers-stack",
        count: s.layers.length,
        core,
        // stack centre and plate size in frame pixels
        at: P ? [510, 800] : [530, 640],
        size: P ? 470 : 450,
      },
    },
  };
}

function renderHero(s: SceneOf<"3d.hero-object">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const P = ctx.portrait;
  return {
    bg: `<div class="hero-floor"></div>`,
    html: `
<div class="hook-flash"></div>
${layer(ctx, "hero")}
<div class="content content--hero">
  <h1 class="title-text" data-split>${withKeyword(s.title, s.keyword)}</h1>
  ${s.subtitle ? `<p class="subtitle">${inline(s.subtitle)}</p>` : ""}
</div>`,
    meta: {
      keyword: !!s.keyword,
      three: { model: s.model ?? "code-cube", symbol: s.symbol ?? "{ }", at: P ? [540, 570] : [1490, 490], size: 380 },
    },
  };
}

async function renderPhone(s: SceneOf<"3d.phone">, _scene: PlannedScene, ctx: Ctx): Promise<Rendered> {
  const P = ctx.portrait;
  const points = (s.points ?? []).slice(0, P ? 1 : 3);
  const img = s.image ? await useAsset(ctx, s.image) : null;
  return {
    html: `
${layer(ctx, "phone")}
${img ? `<img class="three-src" data-src-for="screen" src="${esc(img)}" alt="">` : ""}
<div class="content content--phone3d">
  <h2 class="p3-title">${withKeyword(s.title, s.keyword)}</h2>
  ${points.length ? `<div class="p3-points">${points.map((p, i) => `<div class="p3-point" data-item="${i + 1}"><span class="p3-check">✓</span><span>${inline(p)}</span></div>`).join("")}</div>` : ""}
</div>`,
    meta: {
      points: points.length,
      three: {
        model: "phone",
        at: P ? [503, 700] : [510, 550],
        size: P ? 792 : 860,
        ui: { appBar: s.ui?.appBar ?? "Hồ sơ", rows: s.ui?.rows ?? 4, button: s.ui?.button ?? null },
        image: !!img,
      },
    },
  };
}

function renderPunch3d(s: SceneOf<"energy.punch-3d">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const P = ctx.portrait;
  const tone = s.tone ?? "blue";
  const words = s.punch.trim().split(/\s+/);
  return {
    bg: punchBg(tone),
    html: `
${layer(ctx, "punch")}
<div class="punch" data-tone="${tone}">
  ${s.context ? `<div class="punch-context">${inline(s.context)}</div>` : ""}
  ${ctaRow(s.cta)}
</div>`,
    meta: {
      three: {
        model: "text",
        lines: P ? words : [s.punch.trim()],
        fontSize: P ? 270 : 320,
        lineHeight: P ? 1.1 : 0.9,
        // top-left of the text block
        at: P ? [70, 590] : [110, 350],
        tone,
      },
    },
  };
}

function renderGlobe(s: SceneOf<"news.globe">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const P = ctx.portrait;
  const label = s.label ?? "THẾ GIỚI";
  const primary = s.markers.find((m) => m.primary) ?? s.markers[0];
  const labels = s.markers
    .map((m, i) => (m.label ? `<div class="globe-label${m === primary ? " is-primary" : ""}" data-marker="${i}">${esc(m.label)}</div>` : ""))
    .join("");
  const ticker = hasTicker("news.globe", !!s.ticker?.length, P) ? tickerBar(s.ticker!, s.tickerLabel ?? "CẬP NHẬT") : "";
  return {
    html: `
${layer(ctx, "globe", labels)}
${P ? "" : `<div class="news-top">${newsTag(label, true)}</div>`}
<div class="content content--globe">
  ${P ? newsTag(label, true) : ""}
  <h1 class="news-headline" data-split>${withKeyword(s.headline, s.keyword)}</h1>
  ${s.sub && !P ? `<p class="news-sub">${inline(s.sub)}</p>` : ""}
  ${s.source && !P ? `<div class="globe-source">Nguồn: ${inline(s.source)}</div>` : ""}
</div>
${ticker}`,
    meta: {
      three: {
        model: "globe",
        at: P ? [540, 720] : [1400, 560],
        size: P ? 800 : 760,
        markers: s.markers.map((m) => ({ lat: m.lat, lon: m.lon, primary: m === primary })),
      },
    },
  };
}

export const THREE_TEMPLATES: Record<string, TemplateRenderer> = {
  "3d.layers": renderLayers,
  "3d.hero-object": renderHero,
  "3d.phone": renderPhone,
  "energy.punch-3d": renderPunch3d,
  "news.globe": renderGlobe,
};
