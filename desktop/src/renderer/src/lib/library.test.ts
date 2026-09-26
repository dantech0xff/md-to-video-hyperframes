import { describe, it, expect } from "vitest";
import { brandDraft, brandValue, groupSounds, issuesByField, soundBase, soundFolders } from "./library";

const sound = (name: string, category: string, starter = false) => ({ name, file: `/lib/${name}.mp3`, category, starter });

describe("the sound library on screen", () => {
  it("groups sounds by folder, the user's own first and placeholders last", () => {
    const groups = groupSounds([
      sound("_starter/ui/pop-bubble", "ui", true),
      sound("whoosh", ""),
      sound("ui/click", "ui"),
      sound("transition/whoosh-soft", "transition"),
      sound("ui/pop", "ui"),
    ]);
    expect(groups.map((g) => [g.category, g.starter, g.sounds.map(soundBase)])).toEqual([
      ["", false, ["whoosh"]],
      ["transition", false, ["whoosh-soft"]],
      ["ui", false, ["click", "pop"]],
      ["ui", true, ["pop-bubble"]],
    ]);
    // the folders a new sound can go in: the user's own
    expect(soundFolders([sound("_starter/ui/pop-bubble", "ui", true), sound("quiz/ding", "quiz"), sound("whoosh", "")])).toEqual(["quiz"]);
  });
});

describe("a brand kit in the editor", () => {
  const dan = {
    id: "dan-tech",
    name: "Dan Tech",
    shortName: "Dan Tech",
    tagline: "Build mobile apps",
    website: "dantech.academy",
    handle: "@dantech0xff",
    socials: { github: "github.com/dantech0xff" },
    logo: { onDark: "logo-wordmark.png", onLight: "logo-wordmark-on-light.png", square: "logo-square.png" },
    wordmark: [{ text: "Dan" }, { text: "Tech", color: "#47c038" }],
    colors: { brand: "#0091ff" },
    cta: { landscape: { title: "Học tiếp", subtitle: "Đăng ký kênh" }, portrait: { title: "Theo dõi", subtitle: "Bài đầy đủ" } },
    defaultStyle: "dantech",
  };

  it("reads a kit's fields, and writes them back keeping the ones it does not show", () => {
    const draft = brandDraft(dan);
    expect(draft).toMatchObject({ name: "Dan Tech", wordmark: [{ text: "Dan" }, { text: "Tech", color: "#47c038" }], mascot: { kind: "none" }, logo: { onDark: "logo-wordmark.png" } });
    // unchanged: the same brand.json
    expect(brandValue(dan, draft)).toEqual(dan);
    const edited = brandValue(dan, { ...draft, tagline: "  Học nhanh ", wordmark: [], shortName: "" });
    expect(edited).toMatchObject({ tagline: "Học nhanh", socials: dan.socials, colors: dan.colors });
    expect(edited.wordmark).toBeUndefined();
    expect(edited.shortName).toBeUndefined();
  });

  it("drops a logo the user removed, an empty wordmark part, and the mascot when there is none", () => {
    const draft = brandDraft({ ...dan, mascot: { name: "Bot", kind: "image", poses: { idle: "mascot/idle.png", wave: "" } } });
    expect(draft.mascot).toEqual({ kind: "image", name: "Bot", poses: { idle: "mascot/idle.png" } });
    const value = brandValue(dan, { ...draft, logo: { ...draft.logo, onLight: undefined }, wordmark: [{ text: "Dan" }, { text: " " }], mascot: { kind: "none" } });
    expect(value.logo).toEqual({ onDark: "logo-wordmark.png", square: "logo-square.png" });
    expect(value.wordmark).toEqual([{ text: "Dan" }]);
    expect(value.mascot).toBeUndefined();
    expect(brandValue(dan, { ...draft, mascot: { kind: "builtin", name: " Robo " } }).mascot).toEqual({ name: "Robo", kind: "builtin" });
  });

  it("starts a blank kit with the defaults", () => {
    expect(brandDraft({ name: "Acme" })).toMatchObject({ name: "Acme", defaultStyle: "dantech", wordmark: [], ctaLandscape: { title: "", subtitle: "" }, logo: {} });
  });

  it("puts each field's problems together", () => {
    expect(issuesByField([{ path: "name", message: "a" }, { path: "logo.onDark", message: "b" }, { path: "name", message: "c" }])).toEqual({ name: ["a", "c"], "logo.onDark": ["b"] });
  });
});
