/**
 * Lesson composer — turns a planned timeline into a HyperFrames composition:
 * static end-state HTML for every scene (layout first), plus a JSON plan the
 * browser runtime (runtime/lesson-runtime.js) uses to build the GSAP timeline.
 */
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type { FormatName, LessonScript, SceneOf } from "./schema.js";
import type { LessonTimeline, PlannedScene, CaptionGroup, PlannedBeat } from "./plan.js";
import type { StylePack } from "./styles.js";
import type { BrandKit } from "./brand.js";
import { esc, inline } from "./markup.js";
import { iconSvg, KIND_ICON } from "./icons.js";
import { highlightCode, lineDiff } from "./code-highlight.js";
import { layoutDiagram, flowPath } from "./diagram-layout.js";
import { mascotFor, mascotHtml } from "./mascot.js";

export const DIMS: Record<FormatName, { w: number; h: number }> = {
  landscape: { w: 1920, h: 1080 },
  portrait: { w: 1080, h: 1920 },
};

/** content box (safe area) per format */
export const BOX: Record<FormatName, { x: number; y: number; w: number; h: number }> = {
  landscape: { x: 128, y: 148, w: 1664, h: 800 },
  portrait: { x: 64, y: 300, w: 952, h: 1090 },
};

export interface ComposeInput {
  /** browser runtime source, inlined so HyperFrames sees the timeline registration */
  runtimeJs: string;
  script: LessonScript;
  format: FormatName;
  timeline: LessonTimeline;
  style: StylePack;
  brand: BrandKit;
  captions: CaptionGroup[] | null;
  scriptDir: string;
  outDir: string;
  audioFile: string;
}

interface Ctx extends ComposeInput {
  box: { x: number; y: number; w: number; h: number };
  portrait: boolean;
  assets: Map<string, string>;
}

interface Rendered {
  html: string;
  meta?: Record<string, unknown>;
}

const LEVEL_LABEL: Record<string, string> = { beginner: "Cơ bản", intermediate: "Trung cấp", advanced: "Nâng cao" };
const LETTERS = ["A", "B", "C", "D"];

/** PNG aspect ratio from the IHDR chunk (width/height). */
function pngAspect(path: string): number {
  try {
    const b = readFileSync(path);
    return b.readUInt32BE(16) / b.readUInt32BE(20);
  } catch {
    return 2.2;
  }
}

/** Logo as a background-image block (several <img> with one src confuse HyperFrames media discovery). */
function logoBlock(ctx: Ctx, cls: string): string {
  const file = ctx.style.theme === "light" ? ctx.brand.logo.onLight : ctx.brand.logo.onDark;
  const ratio = pngAspect(join(ctx.brand.dir, file)).toFixed(4);
  return `<div class="brand-logo ${cls}" role="img" aria-label="${esc(ctx.brand.name)}" style="background-image:url('brand/${esc(file)}');aspect-ratio:${ratio}"></div>`;
}

const icon = (ref: string | undefined, cls = ""): string => {
  const svg = iconSvg(ref);
  return svg ? `<span class="icon ${cls}">${svg}</span>` : "";
};

const sceneTitle = (t?: string) => (t ? `<h2 class="scene-title">${inline(t)}</h2>` : "");

async function useAsset(ctx: Ctx, src: string): Promise<string> {
  const hit = ctx.assets.get(src);
  if (hit) return hit;
  await mkdir(join(ctx.outDir, "media"), { recursive: true });
  const name = `${ctx.assets.size + 1}-${basename(src).replace(/[^a-zA-Z0-9._-]/g, "_")}`.slice(0, 80);
  const rel = `media/${name}${extname(name) ? "" : ".img"}`;
  const out = join(ctx.outDir, rel);
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`image download failed (${res.status}): ${src}`);
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
  } else {
    const path = isAbsolute(src) ? src : resolve(ctx.scriptDir, src);
    if (!existsSync(path)) throw new Error(`image not found: ${path}`);
    await copyFile(path, out);
  }
  ctx.assets.set(src, rel);
  return rel;
}

// ── scene renderers ────────────────────────────────────────────────────────

function renderTitle(s: SceneOf<"title">, ctx: Ctx): Rendered {
  const L = ctx.script.lesson;
  const kicker =
    s.kicker ?? [L.series, L.episode ? `Bài ${L.episode}` : null, L.level ? LEVEL_LABEL[L.level] : null].filter(Boolean).join(" · ");
  const icons = (s.icons ?? []).map((i) => icon(i, "chip-icon")).join("");
  const ghost = (s.icons?.[0]?.replace(/^si:/, "") ?? "").toUpperCase();
  return {
    html: `
<div class="content content--title">
  ${ghost ? `<div class="ghost-text" aria-hidden="true">${esc(ghost)}</div>` : ""}
  ${kicker ? `<div class="kicker"><span class="kicker-bar"></span><span class="kicker-text">${esc(kicker)}</span></div>` : ""}
  <h1 class="title-text" data-split>${inline(s.title)}</h1>
  ${s.subtitle ? `<p class="subtitle">${inline(s.subtitle)}</p>` : ""}
  ${icons ? `<div class="icon-row">${icons}</div>` : ""}
</div>`,
  };
}

function renderStatement(s: SceneOf<"statement">): Rendered {
  let text = inline(s.text);
  for (const e of s.emphasis ?? []) {
    const safe = esc(e);
    const i = text.indexOf(safe);
    if (i >= 0) {
      text = `${text.slice(0, i)}<mark class="hl"><span class="hl-bar"></span><span class="hl-text">${safe}</span></mark>${text.slice(i + safe.length)}`;
    }
  }
  return {
    html: `
<div class="content content--statement">
  ${s.icon ? `<div class="statement-icon">${icon(s.icon)}</div>` : ""}
  ${s.tag ? `<div class="tag">${esc(s.tag)}</div>` : ""}
  <div class="statement-text" data-split>${text}</div>
  ${s.sub ? `<p class="statement-sub">${inline(s.sub)}</p>` : ""}
</div>`,
  };
}

const checkSvg = `<svg class="check-svg" viewBox="0 0 24 24"><path class="check-path" d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function renderChecklist(kind: "objectives" | "recap", title: string, items: string[], ico: string): Rendered {
  const lis = items
    .map(
      (t, i) => `
    <li class="check-item" data-item="${i + 1}">
      <span class="check-box">${checkSvg}</span>
      <span class="check-text">${inline(t)}</span>
    </li>`,
    )
    .join("");
  return {
    html: `
<div class="content content--checklist content--${kind}">
  <div class="checklist-head">${icon(ico, "head-icon")}<h2 class="scene-title">${inline(title)}</h2></div>
  <ol class="checklist">${lis}</ol>
</div>`,
  };
}

function renderConcept(s: SceneOf<"concept">): Rendered {
  return {
    html: `
<div class="content content--concept">
  <div class="concept-visual">
    <div class="concept-rings"><i></i><i></i><i></i></div>
    <div class="concept-icon">${iconSvg(s.icon ?? "lightbulb") ?? ""}</div>
  </div>
  <div class="concept-body">
    <div class="tag">${esc(s.tag ?? "Khái niệm")}</div>
    <h2 class="concept-term" data-split>${inline(s.term)}</h2>
    <div class="concept-rule"></div>
    <p class="concept-def">${inline(s.definition)}</p>
    ${s.example ? `<div class="concept-example"><span class="example-label">Ví dụ</span><span class="example-text">${inline(s.example)}</span></div>` : ""}
  </div>
</div>`,
  };
}

function renderBullets(s: SceneOf<"bullets">, ctx: Ctx): Rendered {
  const layout = s.layout ?? (s.items.length >= 4 && !ctx.portrait ? "grid" : "list");
  const items = s.items
    .map((it, i) => {
      const o = typeof it === "string" ? { text: it } : it;
      const badge = s.numbered ? `<span class="item-num">${i + 1}</span>` : icon(o.icon ?? "chevron-right", "item-icon");
      return `
    <div class="item" data-item="${i + 1}">
      <div class="item-badge">${badge}</div>
      <div class="item-body"><div class="item-text">${inline(o.text)}</div>${o.sub ? `<div class="item-sub">${inline(o.sub)}</div>` : ""}</div>
    </div>`;
    })
    .join("");
  return {
    html: `
<div class="content content--bullets" data-layout="${layout}" data-count="${s.items.length}">
  ${sceneTitle(s.title)}
  <div class="items">${items}</div>
</div>`,
  };
}

function editorChrome(file: string | undefined, lang: string): string {
  return `<div class="editor-bar"><span class="dots"><i></i><i></i><i></i></span>${file ? `<span class="editor-file">${esc(file)}</span>` : ""}<span class="editor-lang">${esc(lang.toUpperCase())}</span></div>`;
}

async function renderCode(s: SceneOf<"code">, scene: PlannedScene, ctx: Ctx): Promise<Rendered> {
  const hl = await highlightCode(s.code, s.lang, ctx.style.codeTheme);
  const lines = hl.lines
    .map((l, i) => `<div class="code-line" data-line="${i + 1}"><span class="ln">${i + 1}</span><span class="lc">${l || " "}</span></div>`)
    .join("");
  const notes = scene.beats
    .filter((b) => b.note)
    .map((b) => `<div class="note" data-note="${b.noteId}"><span class="note-dot"></span><span class="note-text">${inline(b.note!)}</span></div>`)
    .join("");
  const maxLen = Math.max(...s.code.split("\n").map((l) => l.replace(/\t/g, "    ").length));
  const typing = s.typing ?? hl.lines.length <= 14;
  return {
    html: `
<div class="content content--code" data-lines="${hl.lines.length}">
  ${sceneTitle(s.title)}
  <div class="code-stage">
    <div class="editor" style="--code-bg:${hl.bg};--code-fg:${hl.fg}">
      ${editorChrome(s.filename, s.lang)}
      <div class="editor-body">
        <div class="focus-bar"></div>
        <div class="code-lines" style="--cols:${Math.max(maxLen, 20)}">${lines}</div>
      </div>
    </div>
    ${notes ? `<div class="notes">${notes}</div>` : ""}
  </div>
</div>`,
    meta: { lines: hl.lines.length, typing, focus: s.focus ? s.focus : null },
  };
}

async function renderDiff(s: SceneOf<"diff">, ctx: Ctx): Promise<Rendered> {
  const rows = lineDiff(s.before.replace(/\s+$/, "").split("\n"), s.after.replace(/\s+$/, "").split("\n"));
  const hl = await highlightCode(rows.map((r) => r.text).join("\n"), s.lang, ctx.style.codeTheme);
  const lines = rows
    .map((r, i) => {
      const mark = r.kind === "add" ? "+" : r.kind === "del" ? "−" : "";
      return `<div class="code-line diff-${r.kind}" data-line="${i + 1}"><span class="ln">${mark}</span><span class="lc">${hl.lines[i] || " "}</span>${r.kind === "del" ? '<span class="strike"></span>' : ""}</div>`;
    })
    .join("");
  const maxLen = Math.max(...rows.map((r) => r.text.length));
  return {
    html: `
<div class="content content--code content--diff">
  ${sceneTitle(s.title)}
  <div class="code-stage">
    <div class="editor" style="--code-bg:${hl.bg};--code-fg:${hl.fg}">
      ${editorChrome(s.filename, s.lang)}
      <div class="editor-body"><div class="code-lines" style="--cols:${Math.max(maxLen, 20)}">${lines}</div></div>
    </div>
  </div>
</div>`,
    meta: { adds: rows.filter((r) => r.kind === "add").length, dels: rows.filter((r) => r.kind === "del").length },
  };
}

function renderTerminal(s: SceneOf<"terminal">): Rendered {
  const body = s.commands
    .map(
      (c, i) => `
      <div class="term-block" data-item="${i + 1}">
        <div class="term-cmd"><span class="prompt">➜</span><span class="cwd">~/app</span><span class="cmd-text" style="--chars:${c.cmd.length}">${esc(c.cmd)}</span><span class="caret"></span></div>
        ${c.output ? `<pre class="term-out">${esc(c.output)}</pre>` : ""}
      </div>`,
    )
    .join("");
  return {
    html: `
<div class="content content--terminal">
  ${sceneTitle(s.title)}
  <div class="terminal">
    <div class="term-bar"><span class="dots"><i></i><i></i><i></i></span><span class="term-title">Terminal — zsh</span></div>
    <div class="term-body">${body}</div>
  </div>
</div>`,
    meta: { commands: s.commands.length, chars: s.commands.map((c) => c.cmd.length) },
  };
}

function renderDiagram(s: SceneOf<"diagram">, scene: PlannedScene, ctx: Ctx): Rendered {
  const titleH = s.title ? (ctx.portrait ? 120 : 110) : 0;
  const W = ctx.box.w;
  const H = ctx.box.h - titleH;
  const dir = s.direction && s.direction !== "auto" ? s.direction : ctx.portrait ? "TB" : "LR";
  const hasLabels = s.edges.some((e) => e.label);
  const L = layoutDiagram(s.nodes, s.edges, {
    dir,
    width: W,
    height: H,
    nodeW: ctx.portrait ? 340 : 330,
    nodeH: ctx.portrait ? 132 : 132,
    gap: ctx.portrait ? 36 : 44,
    rankGap: hasLabels ? (ctx.portrait ? 120 : 190) : 90,
  });
  const id = scene.key;
  const edges = L.edges
    .map((e, i) => {
      const spec = s.edges[i];
      // arrowhead as its own shape so it can pop in when the line arrives
      const [, , , , c2x, c2y, x1, y1] = e.pts;
      const deg = (Math.atan2(y1 - c2y, x1 - c2x) * 180) / Math.PI;
      return `<path class="edge${spec.dashed ? " dashed" : ""}" data-edge="${i}" d="${e.d}"/>` +
        `<g transform="translate(${x1} ${y1}) rotate(${deg.toFixed(1)})"><path class="arrow-head" data-edge="${i}" d="M -16 -9 L 2 0 L -16 9 z"/></g>`;
    })
    .join("");
  // one pre-computed path per flow beat
  let flowId = 0;
  const flows: string[] = [];
  for (const b of scene.beats) {
    if (b.do !== "flow" || !b.path) continue;
    const d = flowPath(b.path, L);
    if (!d) continue;
    (b as PlannedBeat & { flowId?: number }).flowId = flowId;
    flows.push(`<path class="flow-path" id="flow-${id}-${flowId}" data-flow="${flowId}" d="${d}"/>`);
    flowId++;
  }
  const labels = L.edges
    .map((e, i) => (s.edges[i].label ? `<div class="edge-label" data-edge="${i}" style="left:${e.label.x}px;top:${e.label.y}px">${esc(s.edges[i].label!)}</div>` : ""))
    .join("");
  const order = Object.entries(L.nodes).sort((a, b) => a[1].rank - b[1].rank || a[1].order - b[1].order).map(([k]) => k);
  const nodes = s.nodes
    .map((n) => {
      const b = L.nodes[n.id];
      const kind = n.kind ?? "service";
      // shrink label/sub fonts so text never escapes the node box
      const inner = b.w - 136;
      const lfs = Math.max(0.7, Math.min(1, inner / (n.label.length * 19.5)));
      const sfs = n.sub ? Math.max(0.72, Math.min(1, inner / (n.sub.length * 13.4))) : 1;
      return `
    <div class="node" data-node="${esc(n.id)}" data-kind="${kind}" data-rank="${b.rank}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--lfs:${lfs.toFixed(2)};--sfs:${sfs.toFixed(2)}">
      <div class="node-icon">${iconSvg(n.icon ?? KIND_ICON[kind] ?? "box") ?? ""}</div>
      <div class="node-text"><div class="node-label">${inline(n.label)}</div>${n.sub ? `<div class="node-sub">${inline(n.sub)}</div>` : ""}</div>
      <span class="ring-pulse"></span>
    </div>`;
    })
    .join("");
  const packets = Array.from({ length: flowId }, (_, i) => `<div class="packet" data-packet="${i}"><i></i></div>`).join("");
  return {
    html: `
<div class="content content--diagram" data-dir="${dir}">
  ${sceneTitle(s.title)}
  <div class="diagram" style="width:${W}px;height:${H}px">
    <svg class="edges" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${edges}
      ${flows.join("")}
    </svg>
    ${labels}
    ${nodes}
    ${packets}
  </div>
</div>`,
    meta: { order, edges: s.edges.map((e) => [e.from, e.to]), progressive: s.progressive ?? false, flows: flowId },
  };
}

function renderLayers(s: SceneOf<"layers">, ctx: Ctx): Rendered {
  const mode = s.mode ?? "stack";
  if (mode === "onion") {
    const n = s.layers.length;
    const size = ctx.portrait ? 820 : 720;
    const rings = s.layers
      .map((l, i) => {
        const d = size - (i * size) / (n + 0.35);
        const off = Math.round((size - d) / 2);
        return `<div class="ring" data-item="${i + 1}" data-lid="${esc(l.id ?? String(i + 1))}" style="width:${Math.round(d)}px;height:${Math.round(d)}px;left:${off}px;top:${off}px"><span class="ring-name">${inline(l.name)}</span></div>`;
      })
      .join("");
    const legend = s.layers
      .map(
        (l, i) => `<div class="legend-row" data-item="${i + 1}"><span class="legend-dot" style="--i:${i}"></span><div><div class="legend-name">${inline(l.name)}</div>${l.items?.length ? `<div class="legend-items">${l.items.map(esc).join(" · ")}</div>` : ""}${l.note ? `<div class="legend-note">${inline(l.note)}</div>` : ""}</div></div>`,
      )
      .join("");
    return {
      html: `
<div class="content content--layers" data-mode="onion">
  ${sceneTitle(s.title)}
  <div class="onion-wrap">
    <div class="onion" style="width:${size}px;height:${size}px">${rings}<div class="onion-arrow"><span>${esc(s.rule ?? "Phụ thuộc hướng vào trong")}</span></div></div>
    <div class="legend">${legend}</div>
  </div>
</div>`,
      meta: { count: n, mode },
    };
  }
  const core = s.core;
  const bands = s.layers
    .map((l, i) => {
      const chips = (l.items ?? []).map((it) => `<span class="chip">${esc(it)}</span>`).join("");
      let arrow = "";
      if (i < s.layers.length - 1) {
        const dirn = core === undefined ? "down" : i < core ? "down" : "up";
        arrow = `<div class="layer-arrow" data-arrow="${i + 1}" data-dir="${dirn}">${iconSvg(dirn === "down" ? "arrow-down" : "arrow-up") ?? ""}</div>`;
      }
      return `
    <div class="layer${core === i ? " is-core" : ""}" data-item="${i + 1}" data-lid="${esc(l.id ?? String(i + 1))}" style="--i:${i}">
      <div class="layer-name">${inline(l.name)}</div>
      <div class="layer-items">${chips}</div>
      ${l.note ? `<div class="layer-note">${inline(l.note)}</div>` : ""}
    </div>${arrow}`;
    })
    .join("");
  return {
    html: `
<div class="content content--layers" data-mode="stack">
  ${sceneTitle(s.title)}
  <div class="stack">${bands}</div>
  ${s.rule ? `<div class="layers-rule">${icon("info", "rule-icon")}<span>${inline(s.rule)}</span></div>` : ""}
</div>`,
    meta: { count: s.layers.length, mode },
  };
}

async function renderPhone(s: SceneOf<"phone">, ctx: Ctx): Promise<Rendered> {
  const P = ctx.portrait;
  const hasPoints = (s.points?.length ?? 0) > 0;
  const phoneH = P ? (hasPoints ? 760 : 880) : 780;
  const phoneW = Math.round(phoneH * 0.5);
  let screen = "";
  if (s.image) {
    const rel = await useAsset(ctx, s.image);
    screen = `<img class="screen-img" src="${esc(rel)}" alt="">`;
  } else if (s.ui) {
    const u = s.ui;
    const rows =
      u.state === "loading"
        ? Array.from({ length: 5 }, () => `<div class="app-row skeleton"><i class="sk-avatar"></i><div><i class="sk-line"></i><i class="sk-line short"></i></div></div>`).join("")
        : u.state === "error"
          ? `<div class="app-state">${icon("circle-alert", "state-icon")}<div class="state-text">Không tải được dữ liệu</div><div class="state-btn">Thử lại</div></div>`
          : u.state === "empty"
            ? `<div class="app-state">${icon("inbox", "state-icon")}<div class="state-text">Chưa có dữ liệu</div></div>`
            : (u.items ?? [])
                .map(
                  (it, i) => `<div class="app-row" data-row="${i + 1}"><span class="row-avatar">${iconSvg(it.icon ?? "user-round") ?? ""}</span><div class="row-text"><div class="row-title">${esc(it.title)}</div>${it.sub ? `<div class="row-sub">${esc(it.sub)}</div>` : ""}</div><span class="row-chev">${iconSvg("chevron-right") ?? ""}</span></div>`,
                )
                .join("");
    screen = `
      <div class="app">
        <div class="app-bar"><span class="app-bar-title">${esc(u.appBar ?? "Dan Tech App")}</span>${iconSvg("search") ?? ""}</div>
        <div class="app-list">${rows}</div>
        ${u.button ? `<div class="app-button">${esc(u.button)}</div>` : ""}
        ${u.toast ? `<div class="app-toast">${esc(u.toast)}</div>` : ""}
      </div>`;
  }
  const calls = s.callouts ?? [];
  // callout labels on the right of the phone, sorted by y, de-overlapped
  const screenTop = 18;
  const screenH = phoneH - 36;
  const labelX = phoneW + (P ? 56 : 90);
  const sorted = calls.map((c, i) => ({ ...c, i })).sort((a, b) => a.y - b.y);
  let lastY = -1e9;
  const placed = sorted.map((c) => {
    let y = screenTop + (c.y / 100) * screenH;
    if (y < lastY + 92) y = lastY + 92;
    lastY = y;
    return { ...c, ly: y, px: (c.x / 100) * (phoneW - 36) + 18, py: screenTop + (c.y / 100) * screenH };
  });
  const lines = placed
    .map((c) => `<path class="callout-line" data-item="${c.i + 1}" d="M ${phoneW + 6} ${c.py} C ${phoneW + 40} ${c.py}, ${labelX - 50} ${c.ly}, ${labelX - 8} ${c.ly}"/>`)
    .join("");
  const markers = placed
    .map((c) => `<div class="callout-marker" data-item="${c.i + 1}" style="left:${c.px + 16}px;top:${c.py}px">${c.i + 1}</div>`)
    .join("");
  const labels = placed
    .map((c) => `<div class="callout" data-item="${c.i + 1}" style="left:${labelX}px;top:${c.ly}px"><span class="callout-num">${c.i + 1}</span><span class="callout-text">${inline(c.text)}</span></div>`)
    .join("");
  const taps = calls
    .map((c, i) => `<div class="tap" data-tap="${i + 1}" style="left:${c.x}%;top:${c.y}%"><i></i><i></i></div>`)
    .join("");
  const points = hasPoints
    ? `<ul class="points">${s.points!.map((p, i) => `<li class="point" data-point="${i + 1}">${icon("check", "point-icon")}<span>${inline(p)}</span></li>`).join("")}</ul>`
    : "";
  return {
    html: `
<div class="content content--phone${hasPoints ? " has-points" : ""}">
  ${P ? sceneTitle(s.title) : ""}
  <div class="phone-area">
    <div class="phone-wrap" style="width:${calls.length ? labelX + (P ? 400 : 440) : phoneW}px;height:${phoneH}px">
      <div class="phone" data-platform="${s.platform ?? "android"}" style="width:${phoneW}px;height:${phoneH}px">
        <div class="phone-screen">
          <div class="status-bar"><span>9:41</span><span class="sb-icons">${iconSvg("signal") ?? ""}${iconSvg("wifi") ?? ""}${iconSvg("battery-full") ?? ""}</span></div>
          ${screen}
          ${taps}
        </div>
        <div class="phone-island"></div>
      </div>
      <svg class="callout-lines" width="${labelX}" height="${phoneH}">${lines}</svg>
      ${markers}
      ${labels}
    </div>
    ${!P ? `<div class="phone-side">${sceneTitle(s.title)}${points}</div>` : points}
  </div>
</div>`,
    meta: { callouts: calls.length, points: s.points?.length ?? 0, rows: s.ui?.items?.length ?? 0 },
  };
}

function renderCompare(s: SceneOf<"compare">): Rendered {
  const cols = s.columns.length;
  const head = s.columns.map((c, i) => `<div class="cmp-head" data-col="${i}">${inline(c)}</div>`).join("");
  const rows = s.rows
    .map((r, ri) => {
      const cells = r.values
        .map((v, ci) => {
          const content =
            typeof v === "boolean"
              ? `<span class="cmp-bool ${v ? "yes" : "no"}">${iconSvg(v ? "check" : "x") ?? ""}</span>`
              : `<span class="cmp-val">${inline(v)}</span>`;
          return `<div class="cmp-cell" data-col="${ci}">${content}</div>`;
        })
        .join("");
      return `<div class="cmp-row" data-item="${ri + 1}"><div class="cmp-label">${inline(r.label)}</div>${cells}</div>`;
    })
    .join("");
  return {
    html: `
<div class="content content--compare">
  ${sceneTitle(s.title)}
  <div class="cmp" style="--cols:${cols}">
    <div class="cmp-headrow"><div class="cmp-corner"></div>${head}</div>
    ${rows}
    ${s.winner !== undefined ? `<div class="cmp-crown" data-col="${s.winner}" style="--col:${s.winner}">${iconSvg("crown") ?? ""}</div>` : ""}
  </div>
</div>`,
    meta: { rows: s.rows.length, cols, winner: s.winner ?? null },
  };
}

function renderQuiz(s: SceneOf<"quiz">, scene: PlannedScene): Rendered {
  const countdown = scene.pauses.find((p) => p.end - p.start >= 1.5);
  const secs = countdown ? Math.min(Math.round(countdown.end - countdown.start), 10) : 0;
  const nums = Array.from({ length: secs }, (_, i) => `<span class="cd-n" data-n="${secs - i}">${secs - i}</span>`).join("");
  const opts = s.options
    .map(
      (o, i) => `
    <div class="quiz-opt${i === s.answer ? " is-answer" : ""}" data-opt="${i}">
      <span class="opt-letter">${LETTERS[i]}</span><span class="opt-text">${inline(o)}</span>
      <span class="opt-mark">${iconSvg(i === s.answer ? "check" : "x") ?? ""}</span>
    </div>`,
    )
    .join("");
  // deterministic confetti
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const confetti = Array.from({ length: 26 }, (_, i) => {
    const a = rnd() * Math.PI * 2;
    const dist = 160 + rnd() * 260;
    return `<i class="c${i % 4}" style="--dx:${Math.round(Math.cos(a) * dist)}px;--dy:${Math.round(Math.sin(a) * dist - 80)}px;--r:${Math.round(rnd() * 360)}deg"></i>`;
  }).join("");
  return {
    html: `
<div class="content content--quiz">
  <div class="quiz-head">
    <span class="tag">${icon("brain", "tag-icon")}Câu hỏi nhanh</span>
    ${secs ? `<div class="countdown"><svg viewBox="0 0 100 100"><circle class="cd-track" cx="50" cy="50" r="44"/><circle class="cd-ring" cx="50" cy="50" r="44"/></svg><div class="cd-nums">${nums}</div></div>` : ""}
  </div>
  <h2 class="quiz-q">${inline(s.question)}</h2>
  <div class="quiz-opts" data-count="${s.options.length}">${opts}<div class="confetti">${confetti}</div></div>
  ${s.explain ? `<p class="quiz-explain">${icon("lightbulb", "explain-icon")}<span>${inline(s.explain)}</span></p>` : ""}
</div>`,
    meta: { answer: s.answer, options: s.options.length, countdown: countdown ? { start: countdown.start, end: countdown.end, secs } : null },
  };
}

async function renderImage(s: SceneOf<"image">, ctx: Ctx): Promise<Rendered> {
  const rel = await useAsset(ctx, s.src);
  return {
    html: `
<div class="content content--image">
  <div class="image-frame" data-fit="${s.fit ?? "cover"}"><img src="${esc(rel)}" alt=""></div>
  ${s.title || s.caption ? `<div class="image-caption">${s.title ? `<div class="image-title">${inline(s.title)}</div>` : ""}${s.caption ? `<div class="image-sub">${inline(s.caption)}</div>` : ""}</div>` : ""}
</div>`,
    meta: { motion: s.motion ?? "zoom-in" },
  };
}

function renderIntro(ctx: Ctx): Rendered {
  const L = ctx.script.lesson;
  const meta = [L.series, L.episode ? `Bài ${L.episode}` : null].filter(Boolean).join(" · ");
  const lines = Array.from({ length: 9 }, (_, i) => `<i style="--i:${i}"></i>`).join("");
  return {
    html: `
<div class="content content--intro">
  <div class="intro-lines">${lines}</div>
  ${logoBlock(ctx, "intro-logo")}
  <div class="intro-tagline">${esc(ctx.brand.tagline)}</div>
  ${meta ? `<div class="intro-meta">${esc(meta)}</div>` : ""}
</div>`,
  };
}

function renderChapter(scene: PlannedScene, ctx: Ctx): Rendered {
  const total = ctx.script.chapters.length;
  const n = scene.chapterIndex + 1;
  const dots = Array.from({ length: total }, (_, i) => `<i class="${i < scene.chapterIndex ? "done" : i === scene.chapterIndex ? "current" : ""}"></i>`).join("");
  return {
    html: `
<div class="content content--chapter">
  <div class="chapter-ghost" aria-hidden="true">${String(n).padStart(2, "0")}</div>
  <div class="chapter-num">Phần ${n}</div>
  <h2 class="chapter-title" data-split>${inline(scene.chapterTitle)}</h2>
  <div class="chapter-dots">${dots}</div>
</div>`,
  };
}

function renderOutro(ctx: Ctx): Rendered {
  const B = ctx.brand;
  const cta = ctx.portrait ? B.cta.portrait : B.cta.landscape;
  const next = ctx.script.outro.next;
  return {
    html: `
<div class="content content--outro">
  ${logoBlock(ctx, "outro-logo")}
  <h2 class="outro-title" data-split>${esc(cta.title)}</h2>
  <p class="outro-sub">${esc(cta.subtitle)}</p>
  ${next ? `<div class="outro-next"><span class="next-label">${icon("play", "next-icon")}Bài tiếp theo</span><span class="next-title">${inline(next)}</span></div>` : ""}
  <div class="outro-cta">
    <span class="btn btn-primary">${icon("graduation-cap")}${esc(B.website)}</span>
    <span class="btn btn-ghost">${esc(B.handle)}</span>
  </div>
</div>`,
  };
}

async function renderEntry(scene: PlannedScene, ctx: Ctx): Promise<Rendered> {
  if (scene.kind === "intro") return renderIntro(ctx);
  if (scene.kind === "chapter") return renderChapter(scene, ctx);
  if (scene.kind === "outro") return renderOutro(ctx);
  const s = scene.spec!;
  switch (s.type) {
    case "title": return renderTitle(s, ctx);
    case "statement": return renderStatement(s);
    case "objectives": return renderChecklist("objectives", s.title ?? "Sau bài này bạn sẽ", s.items, "target");
    case "recap": return renderChecklist("recap", s.title ?? "Tóm tắt bài học", s.items, "list-checks");
    case "concept": return renderConcept(s);
    case "bullets": return renderBullets(s, ctx);
    case "code": return renderCode(s, scene, ctx);
    case "diff": return renderDiff(s, ctx);
    case "terminal": return renderTerminal(s);
    case "diagram": return renderDiagram(s, scene, ctx);
    case "layers": return renderLayers(s, ctx);
    case "phone": return renderPhone(s, ctx);
    case "compare": return renderCompare(s);
    case "quiz": return renderQuiz(s, scene);
    case "image": return renderImage(s, ctx);
  }
}

// ── document ───────────────────────────────────────────────────────────────

export const VENDOR_SCRIPTS = ["gsap.min.js", "SplitText.min.js", "DrawSVGPlugin.min.js", "MotionPathPlugin.min.js", "ScrambleTextPlugin.min.js"];

export async function composeLesson(input: ComposeInput): Promise<{ html: string; plan: Record<string, unknown> }> {
  const { w, h } = DIMS[input.format];
  const ctx: Ctx = { ...input, box: BOX[input.format], portrait: input.format === "portrait", assets: new Map() };
  const { timeline, style, brand, script } = input;

  const sceneHtml: string[] = [];
  const scenePlans: Record<string, unknown>[] = [];
  for (const s of timeline.scenes) {
    const r = await renderEntry(s, ctx);
    const mascot = mascotFor(s, script, brand, ctx.portrait);
    const mascotMarkup = mascot ? mascotHtml(mascot, s.key, brand) : "";
    sceneHtml.push(`<section class="scene scene--${s.type}" id="sc-${s.key}" data-type="${s.type}" data-kind="${s.kind}">${r.html}${mascotMarkup}\n</section>`);
    const meta: Record<string, unknown> = { ...(r.meta ?? {}) };
    if (mascot) {
      meta.mascot = mascot;
      meta.talk = mascot.talk ? s.words.map((wd) => [r3(wd.start), r3(wd.end)]) : [];
    }
    scenePlans.push({
      key: s.key,
      type: s.type,
      kind: s.kind,
      start: r3(s.start),
      enterAt: r3(s.enterAt),
      voiceStart: r3(s.voiceStart),
      voiceEnd: r3(s.voiceEnd),
      end: r3(s.end),
      until: r3(s.until),
      transition: s.transition,
      beats: s.beats.map((b) => ({ ...b, t: r3(b.t) })),
      pauses: s.pauses.map((p) => ({ start: r3(p.start), end: r3(p.end) })),
      meta,
    });
  }

  const L = script.lesson;
  const chapterPills = timeline.chapters
    .map((c) => `<div class="chapter-pill" data-chapter="${c.index}"><span class="pill-num">${c.index + 1}</span><span class="pill-text">${esc(c.title)}</span></div>`)
    .join("");
  const marks = timeline.chapters
    .filter((c) => c.index > 0)
    .map((c) => `<i style="left:${((c.start / timeline.duration) * 100).toFixed(2)}%"></i>`)
    .join("");
  const shell = `
  <div class="shell">
    ${logoBlock(ctx, "shell-logo")}
    ${!ctx.portrait ? `<div class="shell-episode">${esc([L.series, L.episode ? `Bài ${L.episode}` : null].filter(Boolean).join(" · ") || brand.website)}</div>` : ""}
    ${!ctx.portrait && timeline.chapters.length > 1 ? `<div class="chapter-pills">${chapterPills}</div>` : ""}
    ${!ctx.portrait ? `<div class="progress"><div class="progress-fill"></div><div class="progress-marks">${marks}</div></div>` : ""}
  </div>`;

  const captions = input.captions
    ? `<div class="captions">${input.captions
        .map((g, gi) => `<div class="cap-group" data-g="${gi}">${g.words.map((wd, wi) => `<span class="cap-w" data-w="${wi}">${esc(wd.text)}</span>`).join(" ")}</div>`)
        .join("")}</div>`
    : "";

  const plan = {
    compId: "lesson",
    format: input.format,
    width: w,
    height: h,
    duration: r3(timeline.duration),
    style: style.id,
    theme: style.theme,
    motion: style.motion,
    scenes: scenePlans,
    chapters: timeline.chapters.map((c) => ({ index: c.index, start: r3(c.start) })),
    captions: input.captions?.map((g) => ({ start: r3(g.start), end: r3(g.end), words: g.words.map((wd) => r3(wd.start)) })) ?? [],
  };

  const blinds = Array.from({ length: 8 }, (_, i) => `<i style="--i:${i}"></i>`).join("");
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${w}, height=${h}">
<title>${esc(L.title)}</title>
<link rel="stylesheet" href="fonts/fonts.css">
<link rel="stylesheet" href="lesson.css">
</head>
<body>
<div id="root" data-composition-id="lesson" data-width="${w}" data-height="${h}" data-start="0" data-duration="${timeline.duration.toFixed(3)}" data-format="${input.format}" data-style="${style.id}" data-theme="${style.theme}">
  <div class="bg"><div class="bg-base"></div><div class="bg-grid"></div><div class="bg-glow g1"></div><div class="bg-glow g2"></div><div class="bg-deco"></div><div class="bg-grain"></div><div class="bg-vignette"></div></div>
  <div class="scenes">
${sceneHtml.join("\n")}
  </div>
  <div class="tx-layer"><div class="tx-panel"></div><div class="tx-blinds">${blinds}</div><div class="tx-flash"></div></div>
  ${captions}
  ${shell}
  <audio id="lesson-audio" class="clip" data-start="0" data-duration="${timeline.duration.toFixed(3)}" data-track-index="0" src="${esc(input.audioFile)}"></audio>
</div>
${VENDOR_SCRIPTS.map((f) => `<script src="vendor/${f}"></script>`).join("\n")}
<script>window.__LESSON_PLAN__ = ${JSON.stringify(plan).replace(/</g, "\\u003c")};</script>
<script>
${input.runtimeJs.replace(/<\/script>/gi, "<\\/script>")}
</script>
</body>
</html>
`;
  return { html, plan };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
