# Lesson pipeline v2: kiến trúc và cách mở rộng

Tài liệu này dành cho người bảo trì. Cách viết kịch bản nằm trong skill
[`create-lesson-video`](../../.claude/skills/create-lesson-video/SKILL.md).

## Luồng xử lý

```
script.json (v2) ──► schema.ts (Zod, lỗi có đường dẫn rõ ràng)
      │
      ▼
plan.buildEntries()        danh sách cảnh cho từng định dạng: cold open → intro sting → thẻ chương → … → outro
      │
      ▼
plan.prepareVoice()        voice-text.ts: tách {cue} và {pause:N} → các đoạn TTS
                           tts/lexicon.ts: đổi thuật ngữ sang cách đọc, giữ bản đồ offset để cue không lệch
      │
      ▼
voice.synthesizeSegment()  free: Edge TTS (WordBoundary) · clone: ElevenLabs with-timestamps / LucyLab (SRT)
                           cache voice/seg-<sha1>.mp3 + .json, key = provider|voice|model|rate|lexicon|text
      │
      ▼
plan.buildTimeline()       timing.ts: word timing → offset ký tự → giây
                           cảnh: start → enterAt → voiceStart → voiceEnd → end, hiển thị đến until
                           cue → beat (reveal/focus/flow/tap/answer…), pause, caption word
      │
      ├─► audio-mix.ts     đặt voice (adelay/amix) + SFX (sound-library.ts, chọn theo tên)
      │                    + nhạc (loop, fade, sidechain duck) → loudnorm 2 lượt −14 LUFS
      │
      ├─► compose.ts       HTML ở trạng thái cuối của mọi cảnh + window.__LESSON_PLAN__
      │   + mascot.ts      Dan Bot (SVG) hoặc ảnh PNG theo pose
      │   + runtime/       lesson-runtime.js (nhúng inline): dựng 1 GSAP timeline từ plan
      │                    core.css + styles/<id>/style.css → lesson.css
      │
      ├─► exports.ts       captions.srt/.vtt · chapters.txt (YouTube) · script.txt
      ├─► storyboard.ts    tua timeline trong Chrome headless → storyboard.jpg · preview.mp4
      └─► hyperframes render → video.mp4
```

Mỗi định dạng (landscape, portrait) có một thư mục riêng cạnh `script.json`.
Giọng đọc được tổng hợp một lần và dùng chung cho cả hai định dạng.

## Nguyên tắc khi làm việc với HyperFrames

- **Timeline đơn, đăng ký đồng bộ.** `window.__timelines.lesson` phải được gán ngay
  khi script chạy, nên runtime được nhúng inline vào `index.html` (lint
  `missing_timeline_registry`).
- **Tất định.** Không dùng `Math.random`: runtime dùng hàm `hash()`, còn confetti
  dùng PRNG có seed. Mọi `repeat` đều hữu hạn (`repeats(total, cycle)`). HyperFrames
  seek bằng `totalTime(t)` từng frame, nên callback phải chịu được seek.
- **Bố cục trước, animation sau.** HTML đã là trạng thái cuối và runtime chỉ
  animate *vào* trạng thái đó. Những tween sau trên cùng phần tử dùng
  `fromTo(..., { immediateRender: false })`.
- **Không đặt CSS transform lên phần tử mà GSAP animate**, vì GSAP đọc matrix thành
  px và gây lệch. Composer đặt vị trí bằng `left`/`top`.
- **Logo và ảnh thương hiệu dùng `background-image`.** Nhiều thẻ `<img>` cùng `src`
  sẽ bị lint `duplicate_media_discovery_risk`.
- **Font tự host.** `assets/fonts/fonts.css` có subset `vietnamese`. Compiler của
  HyperFrames bỏ qua các family đã có `@font-face`, nhờ vậy không bị thay bằng
  font Latin-only.

## Mở rộng

### Thêm một style
1. Tạo `src/lesson/styles/<id>/style.json`. Có thể chép từ `dantech` rồi đổi
   `motion`, `transitions`, `sfx` (từ khoá theo mood), `music` và `codeTheme` (theme Shiki).
2. Tạo `src/lesson/styles/<id>/style.css` gồm các token trên
   `#root[data-style="<id>"]`, trang trí nền và token `--m-*` cho mascot.
3. Nếu style cần font mới, thêm font đó vào `scripts/fetch-fonts.ts` rồi chạy `npm run fonts:fetch`
   (font phải có subset tiếng Việt).
4. Kiểm tra bằng `npm run lesson:storyboard -- examples/lessons/repository-pattern/script.json --style <id>`.

### Thêm một loại cảnh
1. `schema.ts`: khai báo Zod object có `...common` và đưa vào `SceneSchema`.
2. `compose.ts`: viết hàm `render<Type>()` trả về HTML trạng thái cuối và `meta` cho runtime.
3. `runtime/lesson-runtime.js`: viết `enter.<type>` và xử lý beat trong `applyBeat`.
4. `runtime/core.css`: bố cục cho cả hai định dạng, dùng `--bx --by --bw --bh` và `--fs-*`.
5. `plan.ts`: nếu cần, thêm `MIN_SCENE` và sự kiện SFX trong `buildSfxEvents`.
6. Thêm test (xem `compose.test.ts`) và cập nhật `reference/scenes.md` trong skill.

### Thương hiệu khác
Tạo `assets/brand/<id>/brand.json` (logo, màu, CTA, mascot), rồi đặt `"brand": "<id>"`
trong kịch bản.

## Kiểm thử và kiểm tra chất lượng

```bash
npm run typecheck && npm test
npx hyperframes lint <run>/landscape   # sau khi dựng storyboard
```

- Test không gọi TTS thật. `src/lesson/test-utils.ts` giả lập voice bằng timing ước lượng.
- Test HTTP của TTS dùng `nock`. Sau proxy, hãy thêm các host được giả lập vào `NO_PROXY`.
- Storyboard là bước duyệt bắt buộc, vì nó chụp đúng frame “hero” của từng cảnh từ
  chính composition sẽ render.

## Hiệu năng (máy 4 nhân)

| Việc | Thời gian |
|---|---|
| TTS 15 đoạn (Edge) | ~10 s (đoạn đã cache: 0 s) |
| Mix âm thanh, 1 định dạng | ~15 s |
| Storyboard, 15 cảnh | ~12 s |
| Render 157 s video 1080p30 | ~14–15 phút (≈ 5,5× thời lượng), ~25 MB |

Bài dài nên render nền. Khi cần nhanh hơn, có thể nâng HyperFrames lên 0.8.x để
render trên cloud (Lambda/Cloud Run); xem phần lộ trình trong
[bản phân tích](2026-09-24-lesson-video-gap-analysis.md).
