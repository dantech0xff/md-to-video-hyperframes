/**
 * Starter sound pack — synthesizes placeholder SFX + one music loop with
 * ffmpeg into <sfx>/_starter/ and <music>/_starter/, so the lesson pipeline
 * has sound before your own library is in place.
 *
 * Your own files always win: `_starter/` sounds are used only when nothing
 * else in the library matches (see sound-library.ts).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sfxDir, musicDir } from "./sound-library.js";
import { ffmpegBin } from "../utils/binaries.js";

interface Spec {
  file: string;
  dur: number;
  expr: string;
  af?: string;
}

const noise = (k = 0) => `(random(${k})*2-1)`;
/** notes starting `gap` seconds apart, each decaying at `decay` */
const arp = (freqs: number[], gap: number, decay: number) =>
  freqs.map((f, i) => `gte(t,${i * gap})*sin(2*PI*${f}*(t-${i * gap}))*exp(-${decay}*(t-${i * gap}))`).join("+");

const SOUNDS: Spec[] = [
  { file: "transition/whoosh-soft", dur: 0.7, expr: `${noise()}*pow(sin(PI*t/0.7),3)`, af: "highpass=f=250,lowpass=f=3500,volume=1.8" },
  { file: "transition/swoosh-fast", dur: 0.4, expr: `${noise()}*pow(sin(PI*t/0.4),2)`, af: "highpass=f=1200,lowpass=f=7000,volume=1.4" },
  { file: "ui/pop-bubble", dur: 0.14, expr: "sin(2*PI*(300*t+2600*t*t))*exp(-28*t)*0.9" },
  { file: "ui/click-soft", dur: 0.05, expr: "sin(2*PI*1900*t)*exp(-180*t)*0.9" },
  { file: "ui/tick-click", dur: 0.04, expr: "sin(2*PI*3200*t)*exp(-260*t)" },
  {
    file: "ui/blip-beep-digital",
    dur: 0.18,
    expr: "(lt(t,0.07)*(gte(sin(2*PI*1320*t),0)*2-1)+gt(t,0.1)*lt(t,0.17)*(gte(sin(2*PI*1760*t),0)*2-1))*0.28",
    af: "lowpass=f=6000",
  },
  { file: "ui/tap-touch", dur: 0.09, expr: "sin(2*PI*(900*t-2200*t*t))*exp(-55*t)*0.9" },
  {
    file: "ui/ding-bell",
    dur: 1.4,
    expr: "(sin(2*PI*1318.5*t)+0.45*sin(2*PI*2637*t)*exp(-3*t)+0.2*sin(2*PI*3955*t)*exp(-6*t))*exp(-3.2*t)*0.55",
  },
  { file: "ui/sparkle-chime", dur: 0.9, expr: `(${arp([1318.5, 1661.2, 1975.5, 2637], 0.06, 7)})*0.35` },
  { file: "ui/zip-swipe", dur: 0.3, expr: `${noise()}*pow(t/0.3,2)*(1-pow(t/0.3,8))`, af: "highpass=f=1800,lowpass=f=9000,volume=1.5" },
  {
    file: "ui/typing-keyboard",
    dur: 2.0,
    expr: "0.5*sin(2*PI*2100*t)*exp(-420*mod(t,0.11))+0.4*sin(2*PI*1500*t)*exp(-380*mod(t+0.05,0.17))",
    af: "highpass=f=600,volume=0.8",
  },
  { file: "quiz/correct-success-chime", dur: 1.0, expr: `(${arp([1046.5, 1318.5, 1568, 2093], 0.07, 5)})*0.32` },
  {
    file: "quiz/wrong-error-buzz",
    dur: 0.45,
    expr: "(gte(sin(2*PI*140*t),0)*2-1)*0.22*(lt(t,0.18)+gt(t,0.24)*lt(t,0.42))",
    af: "lowpass=f=1800",
  },
  {
    file: "quiz/tick-tock-clock-countdown",
    dur: 4.0,
    expr: "0.6*sin(2*PI*2400*t)*exp(-250*mod(t,1))+0.5*sin(2*PI*1600*t)*exp(-250*mod(t+0.5,1))",
  },
  {
    file: "brand/logo-riser-intro",
    dur: 2.4,
    expr: `lt(t,1.4)*(${noise()}*pow(t/1.4,3)*0.7+0.3*sin(2*PI*(200*t+300*t*t))*pow(t/1.4,2))+gte(t,1.4)*sin(2*PI*60*(t-1.4))*exp(-6*(t-1.4))`,
    af: "lowpass=f=6000",
  },
  {
    file: "brand/impact-boom-hit",
    dur: 1.2,
    expr: `sin(2*PI*(45*t+5.833*(1-exp(-12*t))))*exp(-3.5*t)*0.9+${noise()}*exp(-30*t)*0.35`,
    af: "lowpass=f=2500",
  },
  { file: "brand/outro-success-chime", dur: 1.6, expr: `(${arp([784, 1046.5, 1318.5, 1568], 0.1, 2.5)})*0.3` },
];

/** 12.8 s seamless loop at 75 bpm: Am7 – Fmaj7 – Cmaj7 – G pads, soft kick/snare/hats. */
function lofiLoop(): Spec {
  const bar = 3.2;
  const chords = [
    [220, 261.63, 329.63, 392],
    [174.61, 220, 261.63, 329.63],
    [130.81, 164.81, 196, 246.94],
    [196, 246.94, 293.66, 329.63],
  ];
  const inBar = (i: number) => `between(t,${i * bar},${((i + 1) * bar - 0.0001).toFixed(4)})`;
  const pad = chords
    .map((c, i) => `${inBar(i)}*(${c.map((f) => `sin(2*PI*${f}*t)+0.6*sin(2*PI*${(f * 1.004).toFixed(2)}*t)`).join("+")})`)
    .join("+");
  const bass = chords.map((c, i) => `${inBar(i)}*sin(2*PI*${c[0] / 2}*t)`).join("+");
  const env = `pow(sin(PI*mod(t,${bar})/${bar}),0.35)`;
  const kick = "sin(2*PI*(50*mod(t,1.6)+3.6*(1-exp(-25*mod(t,1.6)))))*exp(-9*mod(t,1.6))";
  const snare = `${noise(0)}*exp(-18*mod(t+0.8,1.6))*0.3`;
  const hat = `${noise(1)}*exp(-90*mod(t,0.4))*0.1`;
  return {
    file: "lofi-chill-tech-loop",
    dur: bar * 4,
    expr: `0.06*${env}*(${pad})+0.16*(${bass})*exp(-1.2*mod(t,${bar / 2}))+0.5*${kick}+${snare}+${hat}`,
    af: "lowpass=f=5200,aecho=0.8:0.6:60|120:0.2|0.12",
  };
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(ffmpegBin(), args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", fail);
    p.on("close", (c) => (c === 0 ? ok() : fail(new Error(err.trim().split("\n").slice(-3).join("\n")))));
  });
}

async function render(dir: string, s: Spec, force: boolean): Promise<boolean> {
  const out = join(dir, `${s.file}.mp3`);
  if (!force && existsSync(out)) return false;
  await mkdir(dirname(out), { recursive: true });
  const fade = `afade=t=out:st=${Math.max(0, s.dur - 0.02).toFixed(3)}:d=0.02`;
  await ffmpeg([
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `aevalsrc='${s.expr}':s=44100:d=${s.dur}`,
    "-af", [s.af, fade].filter(Boolean).join(","),
    "-ac", "2", "-b:a", "192k", out,
  ]);
  return true;
}

/** Writes missing starter files (all of them with `force`); returns how many were written. */
export async function makeStarterSounds(opts: { force?: boolean } = {}): Promise<number> {
  const force = !!opts.force;
  let made = 0;
  for (const s of SOUNDS) if (await render(join(sfxDir(), "_starter"), s, force)) made++;
  if (await render(join(musicDir(), "_starter"), lofiLoop(), force)) made++;
  return made;
}
