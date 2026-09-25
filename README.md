<a id="top"></a>

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/dan-tech-academy/logo-wordmark.png">
  <img alt="Dan Tech Academy" src="assets/brand/dan-tech-academy/logo-wordmark-on-light.png" width="180">
</picture>

# md-to-video-hyperframes

### Engine làm video bài giảng lập trình của Dan Tech Academy

Biến một chủ đề, file ghi chú hoặc bài viết thành video bài giảng có lời thoại tiếng Việt và hình xuất hiện đúng lúc được nhắc tới.
**16:9 cho YouTube (có chương)** và **9:16 cho Shorts** được dựng từ cùng một kịch bản, render tất định bằng HyperFrames + GSAP.

[![License](https://img.shields.io/github/license/dantech0xff/md-to-video-hyperframes?style=for-the-badge&color=green)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%2B-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-6-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![HyperFrames](https://img.shields.io/badge/render-HyperFrames-black?style=for-the-badge)](https://hyperframes.heygen.com)
[![dantech.academy](https://img.shields.io/badge/dantech.academy-0091FF?style=for-the-badge)](https://dantech.academy)

[**Tài liệu đầy đủ**](README.full.md) · [**English**](README.en.md) · [**Kiến trúc pipeline**](docs/dan-tech-academy/lesson-pipeline.md) · [**Bắt đầu nhanh**](#bắt-đầu-nhanh) · [**Lộ trình**](#lộ-trình)

</div>

---

## Dự án này là gì

md-to-video-hyperframes là công cụ sản xuất video bài giảng của [Dan Tech Academy](https://dantech.academy), phục vụ các chủ đề lập trình, kiến trúc phần mềm và mobile fullstack: Kotlin/Android, Clean Architecture, backend cho mobile.

Bạn đưa vào một chủ đề, một file `.md`/`.txt` hoặc một URL. AI agent (skill `/create-lesson-video` trong Claude Code hoặc Antigravity) viết kịch bản bài giảng. Phần còn lại do pipeline tất định đảm nhận: tổng hợp giọng đọc kèm timestamp từng từ, dựng hình khớp với lời, trộn âm thanh, render, rồi xuất phụ đề và danh sách chương cho YouTube.

> Từ tháng 9/2026, repo đã tách khỏi fork network của dự án gốc và được phát triển độc lập theo hướng video bài giảng. Pipeline video tin tức 9:16 cũ vẫn chạy được nhưng không còn là trọng tâm, xem [Pipeline tin tức (kế thừa)](#pipeline-tin-tức-kế-thừa).

## Định hướng

1. **Bài giảng là trọng tâm.** Tính năng mới đều phục vụ video dạy lập trình: code, diff, terminal, sơ đồ kiến trúc, màn hình app, quiz.
2. **Một kịch bản, hai định dạng.** Bài dài 16:9 có chương cho YouTube và bản dọc 9:16 cho Shorts dùng chung nội dung và giọng đọc.
3. **Hình bám theo lời.** Cue đặt trong lời thoại được gắn vào timestamp từng từ của TTS, nên mỗi ý, mỗi dòng code, mỗi mũi tên xuất hiện đúng lúc người giảng nhắc tới.
4. **Markdown-first.** Đích đến, đúng như tên repo, là viết bài giảng bằng Markdown rồi biên dịch tất định sang kịch bản, để giảng viên sửa bài mà không phải đụng vào JSON. Hiện tại kịch bản là `script.json` v2; compiler `lesson.md` nằm trong [lộ trình](#lộ-trình).
5. **AI lo phần sáng tạo, code lo phần sản xuất.** Agent chỉ viết kịch bản. Render là tất định: cùng đầu vào cho ra cùng khung hình, dễ review và render lại.
6. **Thương hiệu thay được.** Mặc định dùng brand kit Dan Tech Academy, nhưng logo, màu, CTA và mascot đều nằm trong `assets/brand/<id>/brand.json`.

## Demo

Storyboard của bài mẫu [`examples/lessons/repository-pattern`](examples/lessons/repository-pattern/script.json), "Repository Pattern trong Clean Architecture": 15 cảnh, 157 s ở 16:9 và 154 s ở 9:16.

![Storyboard 16:9 của bài mẫu Repository Pattern](docs/dan-tech-academy/assets/2026-09-24-lesson-v2-landscape.jpg)

<details>
<summary><b>Storyboard 9:16 (Shorts) của cùng kịch bản</b></summary>

![Storyboard 9:16 của bài mẫu Repository Pattern](docs/dan-tech-academy/assets/2026-09-24-lesson-v2-portrait.jpg)

</details>

Ví dụ Shorts viết riêng cho 9:16: [`examples/lessons/short-launch-vs-async`](examples/lessons/short-launch-vs-async/script.json) (Kotlin Coroutines, `launch` hay `async`, style `whiteboard`).

## Tính năng

- **Đồng bộ theo từng từ.** Cue `{1}` `{L3-5}` `{show:api}` `{hl:db}` `{flow:app>api>db}` `{tap:1}` `{zoom:api}` `{answer}` `{pause:4}` viết ngay trong lời thoại.
- **15 loại cảnh cho bài giảng kỹ thuật:** `title`, `statement`, `objectives`, `concept`, `bullets`, `code` (Shiki, hiệu ứng gõ phím, soi dòng kèm ghi chú), `diff`, `terminal`, `diagram` (tự dàn bố cục, gói dữ liệu chạy trên mũi tên), `layers`, `phone` (màn hình app có callout), `compare`, `quiz` (đếm ngược rồi lộ đáp án), `recap`, `image`. Intro, thẻ chương và outro được thêm tự động.
- **4 phong cách hình ảnh:** `dantech`, `blueprint`, `whiteboard`, `terminal`. Mỗi style có màu, font, theme code, easing, bộ chuyển cảnh và mood âm thanh riêng.
- **Mascot Dan Bot:** vẫy tay, chỉ, suy nghĩ, ăn mừng, mấp máy miệng theo lời và đổi màu theo style. Có thể thay bằng ảnh PNG theo từng pose.
- **Âm thanh hoàn chỉnh:** SFX gắn theo sự kiện trên timeline và nhạc nền, đều được **chọn theo tên file**; nhạc tự hạ xuống khi có lời (ducking); cả bài chuẩn hoá về −14 LUFS.
- **Hai lựa chọn giọng:** `free` (Edge TTS, không cần API key, kèm từ điển phát âm thuật ngữ `tech-vi`) và `clone` (giọng giảng viên qua ElevenLabs `eleven_v3` hoặc LucyLab).
- **Bộ file để đăng bài:** `video.mp4`, `captions.srt`/`.vtt`, `chapters.txt` (dán vào mô tả YouTube), `script.txt`, `storyboard.jpg`. Bản 9:16 có phụ đề karaoke in sẵn.
- **Duyệt trước khi render:** storyboard dựng trong khoảng 1 phút, chụp đúng khung hình chính của từng cảnh; `--preview 60:75` xuất một clip ngắn có tiếng để kiểm tra chuyển động.
- **Tiếng Việt hiển thị đúng:** font tự host có subset `vietnamese` (Be Vietnam Pro, Geist Mono, Space Grotesk, Chakra Petch, Patrick Hand).

## Bắt đầu nhanh

**Yêu cầu:** Node.js 22+, FFmpeg và ffprobe trong `PATH`, Chrome hoặc Chromium. HyperFrames tự tải Chrome ở lần render đầu; storyboard tự dò Chrome trên máy, nếu không thấy thì chạy `npx hyperframes browser ensure` hoặc đặt `CHROME_PATH`.

```bash
git clone https://github.com/dantech0xff/md-to-video-hyperframes.git
cd md-to-video-hyperframes
npm install
cp .env.example .env.local   # mặc định dùng giọng free (Edge TTS), không cần API key
```

> Cài FFmpeg: `winget install Gyan.FFmpeg` (Windows) · `brew install ffmpeg` (macOS) · `sudo apt install ffmpeg` (Ubuntu/Debian).

**Render bài mẫu:**

```bash
npm run lesson:storyboard -- examples/lessons/repository-pattern/script.json   # duyệt storyboard (~1 phút)
npm run lesson -- examples/lessons/repository-pattern/script.json              # render 16:9 + 9:16
```

Nếu `assets/sfx/` và `assets/music/` còn trống, pipeline tự tạo bộ âm thanh mẫu vào `_starter/` để chạy thử. Render 1080p30 mất khoảng 5–6 lần thời lượng video trên máy 4 nhân, nên chạy nền với bài dài.

**Tạo bài mới bằng AI agent.** Trong Claude Code (hoặc khung chat của Antigravity IDE):

```text
/create-lesson-video Repository Pattern trong Clean Architecture
/create-lesson-video notes/kotlin-flow.md
/create-lesson-video https://kotlinlang.org/docs/coroutines-basics.html
```

Agent đọc tư liệu, lên dàn ý, viết `lessons/<slug>/script.json`, dựng storyboard để tự kiểm tra, render, rồi soạn `youtube.md` (tiêu đề, mô tả kèm danh sách chương, tag). Muốn làm Shorts thì nói rõ: agent sẽ viết một kịch bản 9:16 riêng dài 45–90 s thay vì ép bài dài vào khung dọc.

Không dùng AI agent cũng được: viết `script.json` theo [hướng dẫn viết kịch bản](README.full.md#viết-kịch-bản-script-v2) và [danh mục cảnh](.claude/skills/create-lesson-video/reference/scenes.md), rồi chạy hai lệnh ở trên.

## Các lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run lesson -- <script.json> [--format landscape\|portrait\|all] [--style …] [--preview 20:35] [--draft\|--high]` | Render video (kèm storyboard) |
| `npm run lesson:storyboard -- <script.json>` | Chỉ dựng `storyboard.jpg` để duyệt nhanh, chưa render |
| `npm run audio:catalog [-- --style terminal]` | Lập `catalog.json` cho SFX và nhạc, in ra mỗi style sẽ chọn file nào |
| `npm run sounds:starter` | Tạo bộ âm thanh mẫu tạm thời vào `_starter/` |
| `npm run voice:clone -- --name "…" samples/*.mp3 --save` | Clone giọng giảng viên (ElevenLabs) và ghi vào `.env.local` |
| `npm run fonts:fetch` | Tải lại các font hỗ trợ tiếng Việt để tự host |
| `npm run typecheck && npm test` | Kiểm tra kiểu và chạy test (Vitest) |

`npm run lesson` còn nhận `--fps 60`, `--crf 18` và `--no-storyboard`.

## Đầu ra

```text
lessons/<slug>/
├── script.json          # kịch bản v2 (agent hoặc bạn viết)
├── youtube.md           # tiêu đề, mô tả, tag (agent soạn)
├── voice/               # cache giọng đọc theo từng câu, dùng chung cho mọi định dạng
├── landscape/           # 1920×1080 cho YouTube
│   ├── video.mp4
│   ├── captions.srt · captions.vtt
│   ├── chapters.txt     # dán vào mô tả YouTube
│   ├── script.txt
│   ├── storyboard.jpg   # kèm storyboard/shot-NNN.png ở kích thước đầy đủ
│   └── preview.mp4      # khi chạy với --preview
└── portrait/            # 1080×1920 cho Shorts, Reels, TikTok (cùng bộ file)
```

Các file do pipeline sinh ra đã nằm trong `.gitignore`.

## Cấu trúc thư mục

```text
md-to-video-hyperframes/
├── .claude/skills/          # skill cho Claude Code: create-lesson-video (chính), create-news-video (kế thừa)
├── .agents/skills/          # cùng bộ skill cho Antigravity IDE
├── src/
│   ├── lesson/              # lesson pipeline v2: schema, timing, voice, audio mix, composer, storyboard
│   │   ├── runtime/         #   runtime GSAP nhúng vào composition
│   │   └── styles/          #   style pack: dantech, blueprint, whiteboard, terminal
│   ├── tts/                 # Edge TTS, ElevenLabs, LucyLab, Vbee, voice clone, từ điển phát âm
│   ├── render/              # chạy HyperFrames (dùng chung) + template của pipeline tin tức
│   ├── assets/              # công cụ FFmpeg (dùng chung), chọn SFX và tải ảnh cho pipeline tin tức
│   ├── config.ts            # đọc cấu hình từ .env.local
│   └── pipeline.ts, cli.ts  # pipeline tin tức 9:16 (kế thừa)
├── assets/
│   ├── brand/dan-tech-academy/   # logo, màu, CTA, mascot (brand.json)
│   ├── fonts/               # font tự host có subset tiếng Việt
│   ├── lexicon/tech-vi.json # cách đọc thuật ngữ cho giọng free
│   └── sfx/, music/         # thư viện âm thanh của bạn, chọn theo tên file
├── examples/lessons/        # kịch bản mẫu
├── scripts/                 # audio catalog, âm thanh mẫu, voice clone, tải font, công cụ SFX
├── docs/
│   ├── dan-tech-academy/    # kiến trúc lesson pipeline, phân tích và lộ trình
│   ├── news-pipeline.md     # tài liệu pipeline tin tức (kế thừa)
│   └── superpowers/         # spec và plan gốc của pipeline tin tức (lưu trữ)
├── tests/fixtures/          # dữ liệu test
├── README.full.md           # tài liệu đầy đủ (tiếng Việt)
└── README.en.md             # English
```

## Tài liệu

- [Tài liệu đầy đủ](README.full.md): cài đặt, cấu hình, viết kịch bản v2, style, âm thanh, giọng đọc, render, xử lý sự cố, FAQ.
- [Kiến trúc lesson pipeline và cách mở rộng](docs/dan-tech-academy/lesson-pipeline.md): thêm style, thêm loại cảnh, dùng thương hiệu khác.
- [Phân tích khoảng trống và lộ trình](docs/dan-tech-academy/2026-09-24-lesson-video-gap-analysis.md).
- Skill `create-lesson-video`: [SKILL.md](.claude/skills/create-lesson-video/SKILL.md) · [danh mục cảnh](.claude/skills/create-lesson-video/reference/scenes.md) · [lời thoại và cue](.claude/skills/create-lesson-video/reference/narration.md) · [style, âm thanh, mascot](.claude/skills/create-lesson-video/reference/look-and-sound.md).
- Thư viện âm thanh: [SFX](assets/sfx/README.md) · [nhạc nền](assets/music/README.md).

## Lộ trình

**Đã xong (lesson pipeline v2):** brand kit và font tiếng Việt tự host; schema v2 theo bài → chương → cảnh; đồng bộ theo từng từ; quiz có đếm ngược; SFX và nhạc chọn theo tên file, ducking, −14 LUFS; 4 style và 9 kiểu chuyển cảnh; cảnh code, diff, terminal, sơ đồ, layers, phone, compare; 16:9 và 9:16 từ một kịch bản, phụ đề, chương YouTube; mascot Dan Bot; storyboard và preview.

**Tiếp theo:**

- [ ] **Markdown-first:** compiler `lesson.md` → script v2 (heading thành chương, code fence thành cảnh code, `:::quiz` thành quiz…).
- [ ] Tự cắt Shorts từ bài dài và tự tạo thumbnail.
- [ ] Nâng HyperFrames lên 0.8.x: shader transitions, render trên cloud cho bài 10–20 phút.
- [ ] Cảnh mới: chart/benchmark, sequence diagram, bài tập "thử tự làm".
- [ ] Thư viện SFX và nhạc có license, giọng clone của giảng viên, mascot chính thức.

Chi tiết từng giai đoạn nằm trong [bản phân tích và lộ trình](docs/dan-tech-academy/2026-09-24-lesson-video-gap-analysis.md#6-lộ-trình-đề-xuất).

## Pipeline tin tức (kế thừa)

Repo vẫn giữ pipeline cũ tạo video tin tức dọc 9:16 (khoảng 60 s) từ URL bài báo hoặc file `.txt`: skill `/create-news-video <url|file>`, `npm run pipeline -- <script.json>` và `npm run rerender -- <thư-mục-output>`. Pipeline này được giữ để tương thích; tính năng mới tập trung vào bài giảng. Xem [docs/news-pipeline.md](docs/news-pipeline.md).

## Giấy phép và nguồn gốc

- Mã nguồn phát hành theo giấy phép [MIT](LICENSE).
- Dự án bắt đầu là một bản fork của [auto-video-gen](https://github.com/Cuongyd196/auto-video-gen) (CuongIT), vốn phát triển từ [Auto-Create-Video](https://github.com/hoquanghai/Auto-Create-Video) của Ho Quang Hai. Pipeline tin tức 9:16 và phần nền HyperFrames/TTS kế thừa từ hai dự án này; thông báo bản quyền gốc được giữ nguyên trong [LICENSE](LICENSE). Nay repo đã tách khỏi fork network và do Dan Tech Academy phát triển độc lập.
- Xây dựng trên [HyperFrames](https://hyperframes.heygen.com) (HeyGen), [GSAP](https://gsap.com), [Shiki](https://shiki.style), [Lucide](https://lucide.dev), [Simple Icons](https://simpleicons.org), [edge-tts-universal](https://www.npmjs.com/package/edge-tts-universal), [ElevenLabs](https://elevenlabs.io), [LucyLab](https://lucylab.io), [Zod](https://zod.dev) và [Vitest](https://vitest.dev). Các font tự host dùng giấy phép SIL OFL (xem `assets/fonts/*/OFL.txt`).

## Liên hệ

**Dan Tech Academy**, *Build mobile apps với AI Native Power*

[Website](https://dantech.academy) · [YouTube](https://youtube.com/channel/UCwZM2_v4Y_vMb_JCjEJ15yw) · [GitHub](https://github.com/dantech0xff) · [Facebook](https://facebook.com/dantech0xff) · [LinkedIn](https://linkedin.com/in/dantech0xff) · [X](https://x.com/dan_0xff)

<div align="center">

**[Lên đầu trang](#top)**

</div>
