import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { composeHtml } from "./html-composer.js";
import type { Script } from "./script-schema.js";

describe("composeHtml", () => {
  it("produces deterministic HTML for sample script with image", () => {
    const script = JSON.parse(readFileSync("tests/fixtures/sample-script-with-image.json", "utf8")) as Script;
    const sceneAudio = [
      { id: "hook",   durationSec: 3.2 },
      { id: "body-1", durationSec: 11.5 },
      { id: "body-2", durationSec: 10.8 },
      { id: "body-3", durationSec: 12.1 },
      { id: "outro",  durationSec: 3.4 },
    ];
    const html = composeHtml({
      script,
      sceneAudio,
      gapSec: 0.3,
      bgImageRelPath: "images/bg.jpg",
      audioRelPath: "voice.mp3",
    });

    // ── HyperFrames structural requirements ──────────────────
    expect(html).toContain('id="stage"');
    expect(html).toContain('data-composition-id="news-video"');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
    expect(html).toContain('data-start="0"');           // root composition timing
    expect(html).toContain('id="voice"');               // audio element discoverable by hyperframes
    expect(html).toContain('class="scene clip"');       // clip class required for hyperframes visibility
    expect(html).toContain('window.__timelines');       // timeline registry (inlined JS)

    // ── Persistent brand shell ────────────────────────────────
    expect(html).toContain('class="brand-shell-header"');
    expect(html).toContain('class="brand-shell-handle"');
    expect(html).toContain('class="brand-shell-keyword"');
    expect(html).toContain('id="grain-overlay"');
    // Shell has no data-start (persistent)
    expect(html).toContain('class="brand-name"');
    expect(html).toContain("Công nghệ 24h");

    // ── Hook scene ─────────────────────────────────────────────
    expect(html).toContain('data-layout="hook"');
    expect(html).toContain('class="hook-headline shimmer-sweep-target"');
    expect(html).toContain("iPhone 17");                // headline content
    expect(html).toContain("Camera 200MP!");            // subhead content

    // Image background (hook has bgSrc + bgImageRelPath provided)
    expect(html).toContain('class="bg kb-zoom-in"');
    expect(html).toContain("background-image: url('images/bg.jpg')");

    // ── Body templates ─────────────────────────────────────────
    // body-1: stat-hero
    expect(html).toContain('data-layout="stat-hero"');
    expect(html).toContain('class="stat-value shimmer-sweep-target"');
    expect(html).toContain('class="stat-label"');
    expect(html).toContain("200MP");

    // body-2: feature-list
    expect(html).toContain('data-layout="feature-list"');
    expect(html).toContain('class="feat-card"');
    expect(html).toContain('class="feat-title"');
    expect(html).toContain("Nâng cấp lớn");

    // body-3: callout
    expect(html).toContain('data-layout="callout"');
    expect(html).toContain('class="callout-card"');
    expect(html).toContain('class="callout-statement"');

    // ── Outro scene ────────────────────────────────────────────
    expect(html).toContain('data-layout="outro"');
    expect(html).toContain('class="out-channel"');
    expect(html).toContain('class="out-underline"');
    expect(html).toContain('class="out-source"');
    expect(html).toContain("Theo dõi ngay");            // ctaTop content
    expect(html).toContain('class="out-cta-top"');

    // Audio src
    expect(html).toContain('src="voice.mp3"');
    expect(html).toMatch(/data-duration="[\d.]+"/);

    // Google Fonts present
    expect(html).toContain("fonts.googleapis.com");
  });

  it("renders educator templates from sample-lesson-script.json", () => {
    const script = JSON.parse(readFileSync("tests/fixtures/sample-lesson-script.json", "utf8")) as Script;
    const sceneAudio = script.scenes.map((s) => ({ id: s.id, durationSec: 5 }));
    const html = composeHtml({
      script,
      sceneAudio,
      gapSec: 0.3,
      bgImageRelPath: null,
      audioRelPath: "voice.mp3",
    });

    expect(html).toContain('data-layout="definition"');
    expect(html).toContain('class="def-term"');
    expect(html).toContain("Quang hợp");

    expect(html).toContain('data-layout="steps"');
    expect(html).toContain('class="step-num"');
    expect(html).toContain("Diệp lục hấp thụ ánh sáng");

    expect(html).toContain('data-layout="formula"');
    expect(html).toContain('class="formula-code"');
    expect(html).toContain("6CO2 + 6H2O → C6H12O6 + 6O2");

    expect(html).toContain('data-layout="myth-fact"');
    expect(html).toContain('class="mf-card mf-myth"');
    expect(html).toContain('class="mf-card mf-fact"');

    expect(html).toContain('data-layout="quiz"');
    expect(html).toContain('class="quiz-question"');
    // only the correct option carries is-correct + the reveal overlay
    expect(html).toContain('class="quiz-opt is-correct"');
    expect(html).toContain('class="quiz-reveal"');
    expect(html).toContain("Oxy");

    expect(html).toContain('data-layout="key-point"');
    expect(html).toContain('class="kp-text shimmer-sweep-target"');
    expect(html).toContain("Không quang hợp, không oxy để thở");
  });

  it("renders timeline + chapter templates", () => {
    const script = {
      version: "1.0" as const,
      metadata: {
        title: "Lịch sử máy tính",
        source: { url: "local", domain: "local", image: null },
        channel: "Học Nhanh",
      },
      voice: { provider: "edge-tts", voiceId: "vi-VN-HoaiMyNeural", speed: 1 },
      scenes: [
        { id: "hook", type: "hook" as const, voiceText: "Máy tính ra đời thế nào?",
          templateData: { template: "hook" as const, headline: "Lịch sử máy tính" } },
        { id: "body-1", type: "body" as const, voiceText: "Phần một: thập niên bốn mươi.",
          templateData: { template: "chapter" as const, number: "PHẦN 1", title: "Thập niên 40" } },
        { id: "body-2", type: "body" as const, voiceText: "Dòng thời gian phát triển.",
          templateData: {
            template: "timeline" as const,
            title: "Mốc lịch sử",
            events: [
              { marker: "1943", text: "ENIAC ra đời" },
              { marker: "1981", text: "IBM PC" },
            ],
          } },
        { id: "outro", type: "outro" as const, voiceText: "Theo dõi để học bài mới.",
          templateData: { template: "outro" as const, ctaTop: "Theo dõi", channelName: "Học Nhanh", source: "local" } },
      ],
    } as Script;
    const sceneAudio = script.scenes.map((s) => ({ id: s.id, durationSec: 4 }));
    const html = composeHtml({ script, sceneAudio, gapSec: 0.3, bgImageRelPath: null, audioRelPath: "voice.mp3" });

    expect(html).toContain('data-layout="chapter"');
    expect(html).toContain('class="chapter-num"');
    expect(html).toContain("PHẦN 1");

    expect(html).toContain('data-layout="timeline"');
    expect(html).toContain('class="tl-item"');
    expect(html).toContain("ENIAC ra đời");
    expect(html).toContain("1981");
  });

  it("falls back to gradient when bgImageRelPath is null", () => {
    const script = JSON.parse(readFileSync("tests/fixtures/sample-script-with-image.json", "utf8")) as Script;
    const sceneAudio = script.scenes.map((s) => ({ id: s.id, durationSec: 5 }));
    const html = composeHtml({
      script,
      sceneAudio,
      gapSec: 0.3,
      bgImageRelPath: null,
      audioRelPath: "voice.mp3",
    });
    // Hook scene with bgSrc but no bgImageRelPath → gradient fallback
    expect(html).toContain('class="bg gradient-news-dark"');
    expect(html).not.toContain("background-image: url");
  });
});
