/**
 * data.*: warm dark "newspaper" infographics with one vermilion accent.
 * Charts are laid out here in pixels (1:1 with the design); the runtime only
 * animates them in (numbers count up from 0, bars and lines draw from the left).
 */
import type { SceneOf } from "../schema.js";
import type { PlannedScene } from "../plan.js";
import { type Ctx, type Rendered, withKeyword, viNumber } from "../compose-kit.js";
import { esc, inline } from "../markup.js";
import type { TemplateRenderer } from "./index.js";

const source = (s: string, cls = "data-source") => `<div class="${cls}">Nguồn: ${inline(s)}</div>`;
const decimals = (n: number) => (Number.isInteger(n) ? 0 : Math.min(2, String(n).split(".")[1]?.length ?? 1));
const fmt = (n: number) => viNumber(n, decimals(n));
/** A number the runtime counts up from 0 (keeps prefix, suffix and separators). */
const count = (text: string, cls: string) => `<span class="${cls}" data-count>${esc(text)}</span>`;

function renderBigNumber(s: SceneOf<"data.big-number">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const P = ctx.portrait;
  const max = Math.max(...(s.series ?? []).map((x) => x.value), 0);
  // one precision for the whole series: 2,4 / 3,0 / 4,2
  const dec = Math.max(0, ...(s.series ?? []).map((x) => decimals(x.value)));
  const barMax = P ? 600 : 390;
  const series = s.series?.length
    ? `<div class="bn-series">${s.series
        .map((x, i) => {
          const last = i === s.series!.length - 1;
          const w = max > 0 ? Math.round((x.value / max) * barMax) : 0;
          return `<div class="bn-row${last ? " is-now" : ""}" data-item="${i + 1}"><span class="bn-q">${esc(x.label)}</span><div class="bn-bar" style="width:${w}px"></div><span class="bn-v">${esc(x.display ?? viNumber(x.value, dec))}</span></div>`;
        })
        .join("")}</div>`
    : "";
  const delta = s.delta
    ? `<div class="bn-delta">${count(s.delta.value, "bn-delta-v")}${s.delta.sub ? `<span class="bn-delta-sub">${inline(s.delta.sub)}</span>` : ""}</div>`
    : "";
  const figure = `<div class="bn-figure">${count(s.value, "bn-value")}${s.unit ? `<span class="bn-unit">${esc(s.unit)}</span>` : ""}</div>`;
  const label = `<div class="bn-label">${inline(s.label)}</div>`;
  const html = P
    ? `<div class="content content--bignum">${figure}${label}${delta}${series}${source(s.source)}</div>`
    : `<div class="content content--bignum"><div class="bn-main">${figure}${label}</div><div class="bn-side">${delta}${series}${source(s.source)}</div></div>`;
  return { html };
}

function renderDumbbell(s: SceneOf<"data.dumbbell">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const P = ctx.portrait;
  const W = P ? 800 : 1100;
  const unit = s.unit ?? "";
  const x = (v: number) => (v / s.axisMax) * W;
  const rows = s.rows
    .map((r, i) => {
      const down = r.b < r.a;
      const tone = r.highlight ? "hot" : down ? "down" : "up";
      const xa = x(r.a), xb = x(r.b);
      const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
      const d = r.b - r.a;
      const deltaTxt = `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmt(Math.abs(d))}`;
      const track = `
        <div class="db-track" style="width:${W}px">
          <div class="db-rail"></div>
          <div class="db-link" style="left:${lo.toFixed(1)}px;width:${(hi - lo).toFixed(1)}px"></div>
          <div class="db-a" style="left:${(xa - 11).toFixed(1)}px"></div>
          <div class="db-b" style="left:${(xb - 17).toFixed(1)}px"></div>
        </div>`;
      const value = `${count(fmt(r.b) + unit, "db-value")}`;
      return P
        ? `<div class="db-row" data-tone="${tone}" data-item="${i + 1}"><div class="db-head"><span class="db-label">${inline(r.label)}</span><span class="db-num">${value}<span class="db-delta">${deltaTxt}</span></span></div>${track}</div>`
        : `<div class="db-row" data-tone="${tone}" data-item="${i + 1}"><span class="db-label">${inline(r.label)}</span>${track}<span class="db-num">${value}</span><span class="db-delta">${deltaTxt}</span></div>`;
    })
    .join("");
  const legend = `<span class="db-key db-key-a"><i></i>${esc(s.legend[0])}</span><span class="db-key db-key-b"><i></i>${esc(s.legend[1])}</span>`;
  const sub = s.subtitle ? `<span>${inline(s.subtitle)}</span>` : "";
  const ticks = P
    ? ""
    : `<div class="db-axis" style="width:${W}px">${[0, 1, 2, 3, 4]
        .map((k) => `<span style="left:${((k / 4) * W).toFixed(0)}px"${k === 0 ? ' class="first"' : ""}>${fmt((s.axisMax * k) / 4)}</span>`)
        .join("")}</div>`;
  return {
    html: `
<div class="content content--dumbbell">
  <h2 class="data-title">${withKeyword(s.title, s.keyword)}</h2>
  <div class="db-legend">${P ? legend + sub : sub + legend}</div>
  <div class="db-rows">${rows}</div>
  ${ticks}
  ${P ? source(s.source) : ""}
</div>
${P ? "" : source(s.source, "data-source data-source--corner")}`,
  };
}

/** Nice tick step for a range split into about `n` intervals. */
function niceStep(range: number, n: number): number {
  const raw = range / n || 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 3, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function renderLine(s: SceneOf<"data.line">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const P = ctx.portrait;
  const W = P ? 872 : 1584;
  const H = P ? 600 : 420;
  const min = Math.min(...s.points), max = Math.max(...s.points);
  const step = niceStep(max - min, 3);
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  if (!ticks.length) ticks.push(min);
  const lo = ticks[0] - step, hi = ticks[ticks.length - 1] + step;
  const y = (v: number) => H * (1 - (v - lo) / (hi - lo));
  const n = s.points.length;
  const px = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const pts = s.points.map((v, i) => `${px(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const grid = ticks
    .map((v) => `<div class="ln-grid" style="top:${y(v).toFixed(0)}px"></div><div class="ln-tick" style="top:${(y(v) - (P ? 38 : 35)).toFixed(0)}px">${fmt(v)}</div>`)
    .join("");
  const last = s.points[n - 1];
  const a = s.annotation;
  let annoSvg = "";
  let annoHtml = "";
  if (a) {
    const ax = px(a.i), ay = y(s.points[a.i]);
    const rightSide = !P || ax < W / 2;
    const style = rightSide ? `left:${(ax + 54).toFixed(0)}px` : `right:${(W + 40 - ax + 16).toFixed(0)}px;text-align:right`;
    annoSvg = `<line class="ln-anno-line" x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${P ? -60 : -40}"/><circle class="ln-anno-dot" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${P ? 11 : 10}"/>`;
    annoHtml = `<div class="ln-anno" style="${style}"><strong>${esc(s.labels[a.i])}</strong> ${inline(a.text)}</div>`;
  }
  const every = P ? Math.ceil(n / 5) : 1;
  const labels = s.labels
    .map((l, i) => ((n - 1 - i) % every === 0 ? `<span${i === n - 1 ? ' class="is-last"' : ""}>${esc(l)}</span>` : ""))
    .join("");
  return {
    html: `
<div class="content content--line">
  <h2 class="data-title">${withKeyword(s.title, s.keyword)}</h2>
  ${s.subtitle ? `<div class="data-sub">${inline(s.subtitle)}</div>` : ""}
  <div class="ln-chart" style="height:${H}px">
    ${grid}
    <div class="ln-base" style="top:${H - 2}px"></div>
    <svg class="ln-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <polygon class="ln-area" points="${pts} ${W},${H} 0,${H}"/>
      ${annoSvg}
      <polyline class="ln-path" points="${pts}"/>
      <circle class="ln-end" cx="${px(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="${P ? 18 : 16}"/>
    </svg>
    ${annoHtml}
    <div class="ln-last">${count(fmt(last), "ln-last-v")}${s.lastLabel ? `<div class="ln-last-sub">${inline(s.lastLabel)}</div>` : ""}</div>
  </div>
  <div class="ln-labels" style="width:${W}px">${labels}</div>
  ${P ? source(s.source) : ""}
</div>
${P ? "" : source(s.source, "data-source data-source--corner")}`,
    meta: { points: n },
  };
}

function renderWaffle(s: SceneOf<"data.waffle">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const cells = Array.from({ length: 100 }, (_, i) => `<i${i < s.percent ? ' class="on"' : ""}></i>`).join("");
  const grid = `<div class="wf-grid">${cells}</div>`;
  const pct = count(`${s.percent}%`, "wf-pct");
  const label = `<div class="wf-label">${inline(s.label)}</div>`;
  return {
    html: ctx.portrait
      ? `<div class="content content--waffle">${pct}${label}${source(s.source)}${grid}</div>`
      : `<div class="content content--waffle">${grid}<div class="wf-text">${pct}${label}${s.sub ? `<div class="wf-sub">${inline(s.sub)}</div>` : ""}${source(s.source)}</div></div>`,
    meta: { percent: s.percent },
  };
}

function renderTimeline(s: SceneOf<"data.timeline">, _scene: PlannedScene, ctx: Ctx): Rendered {
  const [start, end] = s.range;
  const span = end - start;
  const events = [...s.events].sort((a, b) => a.year - b.year);
  const lastIdx = events.length - 1;
  const years = Array.from({ length: span + 1 }, (_, i) => start + i);
  const major = (y: number) => y % 5 === 0 || y === start || y === end;
  let body: string;
  if (!ctx.portrait) {
    const W = 1664;
    const X = (y: number) => ((y - start) / span) * (W - 2);
    const ticks = years.map((y) => `<i class="tl-tick${major(y) ? " major" : ""}" style="left:${X(y).toFixed(0)}px"></i>`).join("");
    const labels = years
      .filter((y) => y % 5 === 0 || y === start || y === end)
      .map((y) => `<span class="tl-year${y === start ? " first" : y === end ? " last" : ""}" style="left:${X(y).toFixed(0)}px">${y}</span>`)
      .join("");
    const ev = events
      .map((e, i) => {
        const x = X(e.year);
        if (i === lastIdx) {
          return `<div class="tl-ev is-last" data-item="${i + 1}"><i class="tl-stem" style="left:${(x - 1).toFixed(0)}px"></i><i class="tl-dot" style="left:${(x - 25).toFixed(0)}px"></i><div class="tl-label" style="right:${(W - x + 39).toFixed(0)}px"><div class="tl-y">${e.year}</div><div class="tl-t">${inline(e.text)}</div></div></div>`;
        }
        const high = i % 2 === 1;
        // keep the label clear of the stems to its right that cross its row
        const blockers = events.slice(i + 1).filter((_, k) => !high || k % 2 === 1 || i + 1 + k === lastIdx);
        const room = blockers.length ? X(blockers[0].year) - x - 34 : 300;
        const width = Math.max(170, Math.min(300, room));
        return `<div class="tl-ev${high ? " high" : ""}" data-item="${i + 1}"><i class="tl-stem" style="left:${(x - 1).toFixed(0)}px"></i><div class="tl-label" style="left:${(x + 17).toFixed(0)}px;width:${width.toFixed(0)}px"><div class="tl-y">${e.year}</div><div class="tl-t">${inline(e.text)}</div></div></div>`;
      })
      .join("");
    body = `<div class="tl-box"><i class="tl-axis"></i>${ticks}${labels}${ev}</div>`;
  } else {
    // 900 px keeps the last event above the caption band (y 1430)
    const H = 900;
    const Y = (y: number) => ((y - start) / span) * H;
    const labels = years
      .filter((y) => y % 5 === 0 || y === start || y === end)
      .map((y) => `<span class="tl-year" style="top:${(Y(y) - 14).toFixed(0)}px">${y}</span><i class="tl-tick" style="top:${Math.min(Y(y), H - 2).toFixed(0)}px"></i>`)
      .join("");
    let prev = -1e9;
    const ev = events
      .map((e, i) => {
        let y = Y(e.year);
        if (i !== lastIdx && y < prev + 62) y = prev + 62;
        prev = y;
        if (i === lastIdx) {
          return `<div class="tl-ev is-last" data-item="${i + 1}"><i class="tl-dot" style="top:${(y - 18).toFixed(0)}px"></i><div class="tl-label" style="top:${(y - 43).toFixed(0)}px"><span class="tl-y">${e.year}</span><span class="tl-t">${inline(e.text)}</span></div></div>`;
        }
        return `<div class="tl-ev" data-item="${i + 1}"><i class="tl-branch" style="top:${y.toFixed(0)}px"></i><div class="tl-label" style="top:${(y - 26).toFixed(0)}px"><span class="tl-y">${e.year}</span><span class="tl-t">${inline(e.text)}</span></div></div>`;
      })
      .join("");
    body = `<div class="tl-box"><i class="tl-axis"></i>${labels}${ev}</div>`;
  }
  return {
    html: `
<h2 class="data-title tl-title">${inline(s.title)}</h2>
${body}`,
    meta: { events: events.length },
  };
}

export const DATA_TEMPLATES: Record<string, TemplateRenderer> = {
  "data.big-number": renderBigNumber,
  "data.dumbbell": renderDumbbell,
  "data.line": renderLine,
  "data.waffle": renderWaffle,
  "data.timeline": renderTimeline,
};
