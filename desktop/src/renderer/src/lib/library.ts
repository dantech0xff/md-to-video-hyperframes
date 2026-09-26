/** The Library screen's pure parts: sound groups, event names, and brand.json as the kit editor's draft. */
import { MASCOT_POSES, type LibrarySound, type MascotPose, type WordmarkPart } from "../../../shared/types";

/** A style's sound events, as the user knows them. */
export const EVENT_LABEL: Record<string, string> = {
  transition: "Chuyển cảnh",
  reveal: "Hiện nội dung",
  focus: "Chuyển điểm nhìn",
  highlight: "Tô từ khoá",
  flow: "Luồng, mũi tên",
  tap: "Chạm màn hình",
  type: "Gõ phím",
  correct: "Trả lời đúng",
  wrong: "Trả lời sai",
  countdown: "Đếm ngược",
  chapter: "Mở chương",
  intro: "Intro",
  outro: "Outro",
  impact: "Nhấn mạnh",
};

export const POSE_LABEL: Record<MascotPose, string> = { idle: "Đứng yên", wave: "Vẫy tay", point: "Chỉ tay", think: "Suy nghĩ", celebrate: "Ăn mừng" };

export interface SoundGroup {
  /** the folder in the library, "" at the top */
  category: string;
  /** placeholders the engine made */
  starter: boolean;
  sounds: LibrarySound[];
}

/** Sounds by folder: the user's own first (the top folder before the others, by name), placeholders last. */
export function groupSounds(sounds: LibrarySound[]): SoundGroup[] {
  const groups = new Map<string, SoundGroup>();
  for (const s of sounds) {
    const key = `${s.starter ? 1 : 0}\n${s.category}`;
    if (!groups.has(key)) groups.set(key, { category: s.category, starter: s.starter, sounds: [] });
    groups.get(key)!.sounds.push(s);
  }
  return [...groups.values()].sort((a, b) => Number(a.starter) - Number(b.starter) || a.category.localeCompare(b.category, "vi"));
}

/** A sound's own name: the last part of its name in the library. */
export function soundBase(sound: Pick<LibrarySound, "name">): string {
  return sound.name.split("/").pop() ?? sound.name;
}

/** The folders sounds can go in: the user's own, by name. */
export function soundFolders(sounds: LibrarySound[]): string[] {
  return [...new Set(sounds.filter((s) => !s.starter && s.category).map((s) => s.category))].sort((a, b) => a.localeCompare(b, "vi"));
}

export type MascotDraft = { kind: "none" } | { kind: "builtin"; name: string } | { kind: "image"; name: string; poses: Partial<Record<MascotPose, string>> };

/** The fields of brand.json the kit editor edits. */
export interface BrandDraft {
  name: string;
  shortName: string;
  tagline: string;
  website: string;
  handle: string;
  ctaLandscape: { title: string; subtitle: string };
  ctaPortrait: { title: string; subtitle: string };
  /** the text wordmark; empty: the PNG logos */
  wordmark: WordmarkPart[];
  defaultStyle: string;
  logo: { onDark?: string; onLight?: string; square?: string };
  mascot: MascotDraft;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const object = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const file = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** A kit's brand.json as the editor's draft (anything missing empty). */
export function brandDraft(value: Record<string, unknown>): BrandDraft {
  const cta = object(value.cta);
  const line = (v: unknown) => ({ title: text(object(v).title), subtitle: text(object(v).subtitle) });
  const logo = object(value.logo);
  const mascot = object(value.mascot);
  const poses = object(mascot.poses);
  return {
    name: text(value.name),
    shortName: text(value.shortName),
    tagline: text(value.tagline),
    website: text(value.website),
    handle: text(value.handle),
    ctaLandscape: line(cta.landscape),
    ctaPortrait: line(cta.portrait),
    wordmark: Array.isArray(value.wordmark) ? value.wordmark.map((p) => ({ text: text(object(p).text), ...(file(object(p).color) ? { color: file(object(p).color) } : {}) })) : [],
    defaultStyle: text(value.defaultStyle) || "dantech",
    logo: { onDark: file(logo.onDark), onLight: file(logo.onLight), square: file(logo.square) },
    mascot:
      mascot.kind === "builtin"
        ? { kind: "builtin", name: text(mascot.name) }
        : mascot.kind === "image"
          ? { kind: "image", name: text(mascot.name), poses: Object.fromEntries(MASCOT_POSES.flatMap((p) => (file(poses[p]) ? [[p, file(poses[p])]] : []))) }
          : { kind: "none" },
  };
}

/**
 * The kit's brand.json with the draft's fields: the fields the editor does
 * not show (colors, fonts, socials…) as they were, an empty optional field
 * left out.
 */
export function brandValue(original: Record<string, unknown>, d: BrandDraft): Record<string, unknown> {
  const value: Record<string, unknown> = { ...original, name: d.name.trim(), tagline: d.tagline.trim(), website: d.website.trim(), handle: d.handle.trim(), defaultStyle: d.defaultStyle };
  if (d.shortName.trim()) value.shortName = d.shortName.trim();
  else delete value.shortName;
  const trimmed = (l: { title: string; subtitle: string }) => ({ title: l.title.trim(), subtitle: l.subtitle.trim() });
  value.cta = { landscape: trimmed(d.ctaLandscape), portrait: trimmed(d.ctaPortrait) };
  const parts = d.wordmark.map((p) => ({ text: p.text.trim(), ...(p.color ? { color: p.color } : {}) })).filter((p) => p.text);
  if (parts.length) value.wordmark = parts;
  else delete value.wordmark;
  const logo = Object.fromEntries(Object.entries({ ...object(original.logo), ...d.logo }).filter(([, v]) => v));
  if (Object.keys(logo).length) value.logo = logo;
  else delete value.logo;
  if (d.mascot.kind === "none") delete value.mascot;
  else if (d.mascot.kind === "builtin") value.mascot = { name: d.mascot.name.trim(), kind: "builtin" };
  else value.mascot = { name: d.mascot.name.trim(), kind: "image", poses: Object.fromEntries(Object.entries(d.mascot.poses).filter(([, v]) => v)) };
  return value;
}

/** The engine's problems with a kit by field, each field's messages together; "" for the kit itself. */
export function issuesByField(issues: { path: string; message: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of issues) (out[i.path] ??= []).push(i.message);
  return out;
}
