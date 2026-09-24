/**
 * Brand mascot / avatar — the built-in "Dan Bot" (inline SVG, recoloured by
 * each style through --m-* CSS tokens) or your own PNG per pose from the
 * brand kit. The runtime animates it: pop-in, floating, blinking, poses
 * (wave · point · think · celebrate) and a mouth that follows the narration.
 */
import type { BrandKit } from "./brand.js";
import type { PlannedScene } from "./plan.js";
import type { LessonScript, MascotPose } from "./schema.js";
import { esc, inline } from "./markup.js";

export interface MascotPlan {
  pose: MascotPose;
  side: "left" | "right";
  say?: string;
  talk: boolean;
}

/** Which scenes get the mascot: explicit `mascot` on the scene, else intro / quiz / outro. */
export function mascotFor(scene: PlannedScene, script: LessonScript, brand: BrandKit, portrait: boolean): MascotPlan | null {
  if (!brand.mascot || script.mascot === "off") return null;
  const side: MascotPlan["side"] = portrait ? "left" : "right";
  const ref = scene.spec?.mascot;
  if (ref === false) return null;
  if (typeof ref === "string") return { pose: ref, side, talk: true };
  if (ref) return { pose: ref.pose, side: ref.side ?? side, say: ref.say, talk: ref.talk ?? true };
  if (scene.kind === "intro") return { pose: "wave", side: "right", talk: false };
  if (scene.kind === "outro") return { pose: "wave", side, talk: true };
  if (scene.type === "quiz") return { pose: "think", side, talk: true };
  return null;
}

const STAR = "M0 -12 C2 -3 3 -2 12 0 C3 2 2 3 0 12 C-2 3 -3 2 -12 0 C-3 -2 -2 -3 0 -12Z";

function builtinSvg(key: string): string {
  const glow = `mglow-${key}`;
  return `<svg class="m-svg" viewBox="-30 -24 260 276" aria-hidden="true">
  <defs><filter id="${glow}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <ellipse class="m-shadow" cx="100" cy="236" rx="58" ry="8"/>
  <g class="m-float">
    <path class="m-stem" d="M100 36 L100 12"/>
    <circle class="m-antenna" cx="100" cy="8" r="10"/>
    <g class="m-arm m-arm-l"><rect x="14" y="100" width="24" height="60" rx="12"/><circle class="m-hand" cx="26" cy="156" r="13"/></g>
    <g class="m-arm m-arm-r"><rect x="162" y="100" width="24" height="60" rx="12"/><circle class="m-hand" cx="174" cy="156" r="13"/></g>
    <rect class="m-foot" x="64" y="182" width="30" height="30" rx="13"/>
    <rect class="m-foot" x="106" y="182" width="30" height="30" rx="13"/>
    <rect class="m-body" x="36" y="32" width="128" height="164" rx="34"/>
    <rect class="m-screen" x="50" y="48" width="100" height="94" rx="24"/>
    <g class="m-face" filter="url(#${glow})">
      <g class="m-eyes"><rect x="70" y="72" width="18" height="28" rx="9"/><rect x="112" y="72" width="18" height="28" rx="9"/><circle class="m-eye-hi" cx="76" cy="79" r="3.4"/><circle class="m-eye-hi" cx="118" cy="79" r="3.4"/></g>
      <g class="m-eyes-happy"><path d="M68 92 Q79 74 90 92"/><path d="M110 92 Q121 74 132 92"/></g>
      <rect class="m-mouth" x="87" y="110" width="26" height="14" rx="7"/>
    </g>
    <ellipse class="m-cheek" cx="64" cy="119" rx="8" ry="5"/>
    <ellipse class="m-cheek" cx="136" cy="119" rx="8" ry="5"/>
    <rect class="m-button" x="84" y="158" width="32" height="10" rx="5"/>
    <circle class="m-led" cx="140" cy="163" r="4.5"/>
    <g class="m-think"><circle cx="170" cy="40" r="5"/><circle cx="187" cy="21" r="8"/><circle cx="208" cy="-4" r="12"/></g>
  </g>
  <g class="m-sparkles">${[
    [-6, 40, 1],
    [206, 60, 0.8],
    [-14, 140, 0.7],
    [214, 146, 1],
  ]
    .map(([x, y, k]) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="${STAR}"/></g>`)
    .join("")}</g>
</svg>`;
}

function imageFigure(brand: BrandKit): string {
  const m = brand.mascot;
  if (!m || m.kind !== "image") return "";
  const poses = Object.entries(m.poses).filter((e): e is [string, string] => typeof e[1] === "string");
  return `<div class="m-float m-talk">${poses
    .map(([pose, file]) => `<div class="m-img" data-pose="${esc(pose)}" style="background-image:url('brand/${esc(file)}')"></div>`)
    .join("")}</div><div class="m-shadow-html"></div>`;
}

export function mascotHtml(m: MascotPlan, key: string, brand: BrandKit): string {
  const kind = brand.mascot?.kind ?? "builtin";
  const figure = kind === "image" ? imageFigure(brand) : builtinSvg(key);
  const bubble = m.say ? `<div class="m-bubble">${inline(m.say)}</div>` : "";
  return `<div class="mascot mascot--${kind}" data-side="${m.side}" data-pose="${m.pose}" aria-hidden="true">${figure}${bubble}</div>`;
}
