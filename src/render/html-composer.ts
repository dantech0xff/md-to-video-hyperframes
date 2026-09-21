import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Script, TemplateDataType } from "./script-schema.js";
import type { TiktokConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_DIR = join(__dirname, "templates");

// Grain overlay HTML inline (from installed component)
const GRAIN_OVERLAY_HTML = `<div id="grain-overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;"><div class="grain-texture"></div></div>`;

// Vignette — darkens far edges so content doesn't feel like it's floating in a flat void.
const VIGNETTE_HTML = `<div class="vignette"></div>`;

// Default TikTok config (used if not passed)
const DEFAULT_TIKTOK: TiktokConfig = {
  displayName: "CườngIT",
  handle: "@cuongit96",
  followers: "2k followers",
};

export interface SceneAudio {
  id: string;
  durationSec: number;
}

export interface ComposeArgs {
  script: Script;
  sceneAudio: SceneAudio[];
  gapSec: number;
  bgImageRelPath: string | null;   // null => no image available
  audioRelPath: string;
  /** TikTok follow card config (injected into outro scene). Optional — defaults used if omitted. */
  tiktok?: TiktokConfig;
  /** Relative path to avatar image inside the output dir (e.g. "tiktok-avatar.jpg"). */
  tiktokAvatarRelPath?: string;
  /** Extra seconds added to outro scene visual duration after voice ends (TikTok card hold). Default 3. */
  outroHoldSec?: number;
}

export function composeHtml(args: ComposeArgs): string {
  const { script, sceneAudio, gapSec, bgImageRelPath, audioRelPath } = args;
  const tiktok = args.tiktok ?? DEFAULT_TIKTOK;
  const tiktokAvatar = args.tiktokAvatarRelPath ?? "tiktok-avatar.jpg";
  const outroHoldSec = args.outroHoldSec ?? 3;

  // Compute timing per scene. Outro scene gets extra HOLD seconds so the
  // TikTok follow card stays visible after the voice ends.
  let cursor = 0;
  const timing = script.scenes.map((scene) => {
    const audio = sceneAudio.find((a) => a.id === scene.id);
    if (!audio) throw new Error(`No audio entry for scene id=${scene.id}`);
    const isOutro = scene.type === "outro";
    const dur = audio.durationSec + gapSec + (isOutro ? outroHoldSec : 0);
    const start = cursor;
    cursor += dur;
    return { scene, start, duration: dur };
  });
  const totalDuration = cursor;

  // Render scenes
  const sceneHtml = timing.map(({ scene, start, duration }) => {
    return renderScene(scene, start, duration, bgImageRelPath, tiktok, tiktokAvatar);
  }).join("\n");

  // Persistent shell — uses tiktok handle in footer
  const shellHtml = renderShell(script.metadata, tiktok);

  const animJs = readFileSync(join(TPL_DIR, "animations.js"), "utf8");

  const tpl = readFileSync(join(TPL_DIR, "base.html.tmpl"), "utf8");
  return tpl
    .replace("{{TITLE}}", escapeHtml(script.metadata.title))
    .replace(/\{\{TOTAL_DURATION\}\}/g, totalDuration.toFixed(2))
    .replace("{{SHELL}}", shellHtml)
    .replace("{{SCENES}}", sceneHtml)
    .replace(/src="voice\.mp3"/g, `src="${audioRelPath}"`)
    .replace('<script src="animations.js"></script>', `<script>\n${animJs}\n</script>`);
}

// ── PERSISTENT SHELL ───────────────────────────────────────────────────────
function renderShell(metadata: Script["metadata"], tiktok: TiktokConfig): string {
  const channel = escapeHtml(metadata.channel);
  const domain = escapeHtml(metadata.source.domain);
  const handle = escapeHtml(tiktok.handle);
  return `
<!-- Shell: persistent brand elements (no data-start → always visible) -->
<div class="shell-bg"></div>

<div class="brand-shell-header">
  <div class="brand-icon">&gt;_</div>
  <div class="brand-text">
    <div class="brand-name">${channel}</div>
    <div class="brand-tag">BLOG IT</div>
  </div>
</div>

<div class="brand-shell-handle">
  <span class="handle-music">&#9835;</span>
  <span class="handle-text">${handle}</span>
</div>

<div class="brand-shell-keyword">
  <span>${escapeHtml(domain)}</span>
</div>

${VIGNETTE_HTML}
${GRAIN_OVERLAY_HTML}`.trim();
}

// ── SCENE DISPATCH ─────────────────────────────────────────────────────────
function renderScene(
  scene: Script["scenes"][number],
  start: number,
  duration: number,
  bgImageRelPath: string | null,
  tiktok: TiktokConfig,
  tiktokAvatarRelPath: string,
): string {
  const td = scene.templateData;

  let inner: string;
  let layoutName: string;

  switch (td.template) {
    case "hook":
      inner = renderHookInner(td, bgImageRelPath);
      layoutName = "hook";
      break;
    case "comparison":
      inner = renderComparisonInner(td);
      layoutName = "comparison";
      break;
    case "stat-hero":
      inner = renderStatHeroInner(td);
      layoutName = "stat-hero";
      break;
    case "feature-list":
      inner = renderFeatureListInner(td);
      layoutName = "feature-list";
      break;
    case "callout":
      inner = renderCalloutInner(td);
      layoutName = "callout";
      break;
    case "outro":
      inner = renderOutroInner(td, tiktok, tiktokAvatarRelPath);
      layoutName = "outro";
      break;
    case "definition":
      inner = renderDefinitionInner(td);
      layoutName = "definition";
      break;
    case "steps":
      inner = renderStepsInner(td);
      layoutName = "steps";
      break;
    case "timeline":
      inner = renderTimelineInner(td);
      layoutName = "timeline";
      break;
    case "quiz":
      inner = renderQuizInner(td);
      layoutName = "quiz";
      break;
    case "myth-fact":
      inner = renderMythFactInner(td);
      layoutName = "myth-fact";
      break;
    case "key-point":
      inner = renderKeyPointInner(td);
      layoutName = "key-point";
      break;
    case "formula":
      inner = renderFormulaInner(td);
      layoutName = "formula";
      break;
    case "chapter":
      inner = renderChapterInner(td);
      layoutName = "chapter";
      break;
    default: {
      const _never: never = td;
      throw new Error(`Unknown template: ${(_never as any).template}`);
    }
  }

  return buildScene(scene, start, duration, layoutName, inner);
}

// ── HOOK SCENE ─────────────────────────────────────────────────────────────
function renderHookInner(td: Extract<TemplateDataType, { template: "hook" }>, bgImageRelPath: string | null): string {
  // Background
  const hasImage = Boolean(td.bgSrc && bgImageRelPath);
  let bgHtml: string;
  if (hasImage) {
    // Ken Burns image
    const kbClass = td.kenBurns ?? "zoom-in";
    bgHtml = `<div class="bg kb-${kbClass}" style="background-image: url('${bgImageRelPath}')"></div>`;
  } else {
    bgHtml = `<div class="bg gradient-news-dark"></div>`;
  }
  // Only darken when there's a real photo to tame for text legibility —
  // our own gradient backgrounds are already tuned for contrast, and a flat
  // black scrim on top of them just muddies the theme's colors (esp. light-pro).
  const overlayHtml = hasImage ? `<div class="overlay" style="opacity: 0.55"></div>` : "";

  const headline = escapeHtml(td.headline);
  const subhead = td.subhead ? escapeHtml(td.subhead) : "";

  return `${bgHtml}
  ${overlayHtml}
  <div class="layout-hook">
    <div class="hook-headline shimmer-sweep-target">${headline}</div>
    ${subhead ? `<div class="hook-subhead">${subhead}</div>` : ""}
  </div>`;
}

// ── COMPARISON SCENE ───────────────────────────────────────────────────────
function renderComparisonInner(td: Extract<TemplateDataType, { template: "comparison" }>): string {
  const lColor = td.left.color;  // "cyan" | "purple"
  const rColor = td.right.color;
  const winnerClass = td.right.winner ? " card-winner" : "";

  return `
<div class="layout-comparison">
  <div class="cmp-card cmp-left color-${lColor}">
    <div class="cmp-label">${escapeHtml(td.left.label)}</div>
    <div class="cmp-value">${escapeHtml(td.left.value)}</div>
  </div>
  <div class="cmp-vs">VS</div>
  <div class="cmp-card cmp-right color-${rColor}${winnerClass}">
    <div class="cmp-label">${escapeHtml(td.right.label)}</div>
    <div class="cmp-value">${escapeHtml(td.right.value)}</div>
    ${td.right.winner ? '<div class="cmp-winner-badge">WINNER</div>' : ""}
  </div>
</div>`.trim();
}

// ── STAT HERO SCENE ────────────────────────────────────────────────────────
function renderStatHeroInner(td: Extract<TemplateDataType, { template: "stat-hero" }>): string {
  const context = td.context ? `<div class="stat-context">${escapeHtml(td.context)}</div>` : "";
  return `
<div class="layout-stat-hero">
  <div class="stat-value shimmer-sweep-target">${escapeHtml(td.value)}</div>
  <div class="stat-label">${escapeHtml(td.label)}</div>
  ${context}
</div>`.trim();
}

// ── FEATURE LIST SCENE ─────────────────────────────────────────────────────
function renderFeatureListInner(td: Extract<TemplateDataType, { template: "feature-list" }>): string {
  const bullets = td.bullets.map((b, i) =>
    `<div class="feat-bullet feat-bullet-${i}" data-idx="${i}">
      <div class="feat-dot"></div>
      <div class="feat-text">${escapeHtml(b)}</div>
    </div>`
  ).join("\n    ");

  return `
<div class="layout-feature-list">
  <div class="feat-card">
    <div class="feat-title">${escapeHtml(td.title)}</div>
    <div class="feat-rule"></div>
    <div class="feat-bullets">
      ${bullets}
    </div>
  </div>
</div>`.trim();
}

// ── CALLOUT SCENE ──────────────────────────────────────────────────────────
function renderCalloutInner(td: Extract<TemplateDataType, { template: "callout" }>): string {
  const tag = td.tag ? `<div class="callout-tag">${escapeHtml(td.tag)}</div>` : "";
  return `
<div class="layout-callout">
  <div class="callout-card">
    ${tag}
    <div class="callout-statement">${escapeHtml(td.statement)}</div>
  </div>
</div>`.trim();
}

// ── DEFINITION SCENE (educator) ───────────────────────────────────────────
function renderDefinitionInner(td: Extract<TemplateDataType, { template: "definition" }>): string {
  const tag = td.tag ? `<div class="def-tag">${escapeHtml(td.tag)}</div>` : "";
  return `
<div class="layout-definition">
  <div class="def-card">
    ${tag}
    <div class="def-term">${escapeHtml(td.term)}</div>
    <div class="def-rule"></div>
    <div class="def-text">${escapeHtml(td.definition)}</div>
  </div>
</div>`.trim();
}

// ── STEPS SCENE (educator) ────────────────────────────────────────────────
function renderStepsInner(td: Extract<TemplateDataType, { template: "steps" }>): string {
  const items = td.items.map((item, i) =>
    `<div class="step-item" data-idx="${i}">
      <div class="step-num">${i + 1}</div>
      <div class="step-text">${escapeHtml(item)}</div>
    </div>`
  ).join("\n      ");

  return `
<div class="layout-steps">
  <div class="steps-card">
    <div class="steps-title">${escapeHtml(td.title)}</div>
    <div class="steps-rule"></div>
    <div class="steps-list">
      ${items}
    </div>
  </div>
</div>`.trim();
}

// ── TIMELINE SCENE (educator) ─────────────────────────────────────────────
function renderTimelineInner(td: Extract<TemplateDataType, { template: "timeline" }>): string {
  const events = td.events.map((e, i) =>
    `<div class="tl-item" data-idx="${i}">
      <div class="tl-node"></div>
      <div class="tl-marker">${escapeHtml(e.marker)}</div>
      <div class="tl-text">${escapeHtml(e.text)}</div>
    </div>`
  ).join("\n      ");

  return `
<div class="layout-timeline">
  <div class="tl-title">${escapeHtml(td.title)}</div>
  <div class="tl-list">
    ${events}
  </div>
</div>`.trim();
}

// ── QUIZ SCENE (educator) ─────────────────────────────────────────────────
const QUIZ_LETTERS = ["A", "B", "C", "D"];
function renderQuizInner(td: Extract<TemplateDataType, { template: "quiz" }>): string {
  if (td.answerIndex >= td.options.length) {
    throw new Error(`quiz template: answerIndex ${td.answerIndex} >= options.length ${td.options.length}`);
  }
  const options = td.options.map((opt, i) => {
    const correct = i === td.answerIndex ? " is-correct" : "";
    return `<div class="quiz-opt${correct}" data-idx="${i}">
      <div class="quiz-letter">${QUIZ_LETTERS[i]}</div>
      <div class="quiz-opt-text">${escapeHtml(opt)}</div>
      <div class="quiz-check">&#10003;</div>
    </div>`;
  }).join("\n      ");

  return `
<div class="layout-quiz">
  <div class="quiz-badge">CÂU HỎI</div>
  <div class="quiz-question">${escapeHtml(td.question)}</div>
  <div class="quiz-options">
    ${options}
  </div>
</div>`.trim();
}

// ── MYTH vs FACT SCENE (educator) ─────────────────────────────────────────
function renderMythFactInner(td: Extract<TemplateDataType, { template: "myth-fact" }>): string {
  return `
<div class="layout-mythfact">
  <div class="mf-card mf-myth">
    <div class="mf-tag">LẦM TƯỞNG</div>
    <div class="mf-text">${escapeHtml(td.myth)}</div>
    <div class="mf-x">&#10007;</div>
  </div>
  <div class="mf-card mf-fact">
    <div class="mf-tag">SỰ THẬT</div>
    <div class="mf-text">${escapeHtml(td.fact)}</div>
    <div class="mf-check">&#10003;</div>
  </div>
</div>`.trim();
}

// ── KEY POINT SCENE (educator) ────────────────────────────────────────────
function renderKeyPointInner(td: Extract<TemplateDataType, { template: "key-point" }>): string {
  const tag = td.tag ? `<div class="kp-tag">${escapeHtml(td.tag)}</div>` : "";
  return `
<div class="layout-key-point">
  <div class="kp-glyph">&#9733;</div>
  ${tag}
  <div class="kp-text shimmer-sweep-target">${escapeHtml(td.point)}</div>
</div>`.trim();
}

// ── FORMULA SCENE (educator) ──────────────────────────────────────────────
function renderFormulaInner(td: Extract<TemplateDataType, { template: "formula" }>): string {
  const label = td.label ? `<div class="formula-label">${escapeHtml(td.label)}</div>` : "";
  return `
<div class="layout-formula">
  <div class="formula-card">
    ${label}
    <div class="formula-code">${escapeHtml(td.formula)}</div>
    <div class="formula-caption">${escapeHtml(td.caption)}</div>
  </div>
</div>`.trim();
}

// ── CHAPTER SCENE (educator) ──────────────────────────────────────────────
function renderChapterInner(td: Extract<TemplateDataType, { template: "chapter" }>): string {
  return `
<div class="layout-chapter">
  <div class="chapter-num">${escapeHtml(td.number)}</div>
  <div class="chapter-rule"></div>
  <div class="chapter-title">${escapeHtml(td.title)}</div>
</div>`.trim();
}

// ── OUTRO SCENE ────────────────────────────────────────────────────────────
function renderOutroInner(
  td: Extract<TemplateDataType, { template: "outro" }>,
  tiktok: TiktokConfig,
  avatarRelPath: string,
): string {
  const ttCard = renderTiktokCard(tiktok, avatarRelPath);
  return `
<div class="layout-outro">
  <div class="out-cta-top">${escapeHtml(td.ctaTop)}</div>
  <div class="out-channel">${escapeHtml(td.channelName)}</div>
  <div class="out-underline"></div>
  <div class="out-source">Nguồn: ${escapeHtml(td.source)}</div>
</div>
${ttCard}`.trim();
}

/**
 * TikTok follow card — adapted from HyperFrames `tiktok-follow` block.
 * Slides up from bottom mid-outro. Animations are added by animations.js
 * targeting elements with id="tt-card", id="tt-follow-btn", etc.
 */
function renderTiktokCard(tiktok: TiktokConfig, avatarRelPath: string): string {
  return `
<div id="tt-card" class="tt-card">
  <img class="tt-avatar" src="${escapeHtml(avatarRelPath)}" alt="${escapeHtml(tiktok.displayName)}" crossorigin="anonymous" />
  <div class="tt-profile-info">
    <div class="tt-display-name">${escapeHtml(tiktok.displayName)}</div>
    <div class="tt-handle">${escapeHtml(tiktok.handle)}</div>
    <div class="tt-followers">${escapeHtml(tiktok.followers)}</div>
  </div>
  <div id="tt-follow-btn" class="tt-follow-btn">
    <span id="tt-btn-follow" class="tt-btn-text">Follow</span>
    <span id="tt-btn-following" class="tt-btn-text tt-btn-text-following">
      <span>Following</span>
      <span class="tt-check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
    </span>
  </div>
</div>`.trim();
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function buildScene(
  scene: Script["scenes"][number],
  start: number,
  duration: number,
  layoutName: string,
  innerHtml: string,
): string {
  return `
<div class="scene clip" id="scene-${scene.id}"
     data-start="${start.toFixed(2)}" data-duration="${duration.toFixed(2)}" data-active="0"
     data-layout="${layoutName}">
  ${innerHtml}
</div>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
