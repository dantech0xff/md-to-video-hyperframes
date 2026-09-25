# Pipeline tin tức 9:16 (kế thừa)

> **Trạng thái:** kế thừa. Đây là pipeline đầu tiên của repo, có từ trước khi dự án chuyển sang
> làm video bài giảng cho Dan Tech Academy. Nó vẫn chạy được và vẫn có test, nhưng tính năng mới
> tập trung vào [lesson pipeline v2](../README.full.md). Nếu bạn đang làm bài giảng, không cần đọc
> tài liệu này.

Pipeline này biến một bài báo (URL) hoặc file `.txt` thành video tin tức dọc 1080×1920, khoảng 60 s,
có giọng đọc tiếng Việt, motion graphics HTML/CSS/GSAP và SFX. Đầu ra kèm `voice.mp3` và `script.txt`
để chỉnh tiếp trên CapCut nếu cần.

## Chạy

```bash
# Tự động bằng AI agent (Claude Code hoặc Antigravity IDE)
/create-news-video https://vnexpress.net/bai-viet-cua-ban
/create-news-video news/bai-viet.txt

# Chạy thẳng từ kịch bản v1 có sẵn
npm run pipeline -- output/<slug>-<timestamp>/script.json

# Render lại phần hình, giữ nguyên giọng đã tổng hợp
npm run rerender -- output/<slug>-<timestamp>
```

Skill `create-news-video` ([Claude Code](../.claude/skills/create-news-video/SKILL.md),
[Antigravity](../.agents/skills/create-news-video/SKILL.md)) đọc bài, viết kịch bản tiếng Việt
khoảng 150–200 từ, chọn template cho từng cảnh, chạy pipeline, rồi viết thêm `caption.txt`
(một câu caption và 4 hashtag).

## Kịch bản v1

Nguồn chuẩn là [`src/render/script-schema.ts`](../src/render/script-schema.ts); ví dụ hợp lệ ở
[`tests/fixtures/sample-script-no-image.json`](../tests/fixtures/sample-script-no-image.json).

```jsonc
{
  "version": "1.0",
  "metadata": {
    "title": "…",
    "source": { "url": "https://…", "domain": "vnexpress.net", "image": "https://…/og.jpg" },
    "channel": "Dan Tech Academy"
  },
  "voice": { "provider": "edge-tts", "voiceId": "${VOICE_ID}", "speed": 1.0 },
  "scenes": [
    { "id": "hook", "type": "hook", "voiceText": "…", "templateData": { "template": "hook", "headline": "…" } }
    // 5–8 cảnh: 1 hook + 3–6 body + 1 outro
  ]
}
```

`voiceId` là `${VOICE_ID}` (hoặc `${VIETNAMESE_VOICEID}`) thì pipeline thay bằng giọng cấu hình
cho `TTS_PROVIDER`.

**14 template** (`templateData.template`):

| Template | Khi nào dùng |
|---|---|
| `hook` | Cảnh đầu: headline lớn + subhead, nền ảnh og:image nếu có |
| `comparison` | "X so với Y": hai thẻ cạnh nhau |
| `stat-hero` | Một con số nổi bật + nhãn + ngữ cảnh |
| `feature-list` | Tiêu đề + tối đa 4 gạch đầu dòng |
| `callout` | Một nhận định hoặc cảnh báo |
| `outro` | Cảnh cuối: CTA + tên kênh + "Nguồn: <domain>", kèm thẻ follow |
| `definition` | Thuật ngữ + định nghĩa |
| `steps` | Các bước đánh số |
| `timeline` | Mốc thời gian |
| `quiz` | Câu hỏi A–D, đáp án đúng sáng lên cuối cảnh |
| `myth-fact` | "Lầm tưởng" và "sự thật" |
| `key-point` | Điều cần ghi nhớ |
| `formula` | Công thức hoặc một dòng code |
| `chapter` | Thẻ phân mục |

Giới hạn ký tự của từng trường nằm trong schema. Tám template sau (`definition` → `chapter`) là
bộ layout giáo dục đời đầu; bài giảng hiện nay dùng lesson pipeline v2 thay cho chúng.

## Cấu hình

Trong `.env.local`:

| Biến | Ý nghĩa |
|---|---|
| `TTS_PROVIDER` | `edge-tts` (mặc định, miễn phí, không cần key), `lucylab`, `elevenlabs` hoặc `vbee` |
| `EDGE_TTS_VOICE`, `EDGE_TTS_RATE`, `EDGE_TTS_PITCH`, `EDGE_TTS_VOLUME` | Giọng Edge: `vi-VN-NamMinhNeural`, `vi-VN-HoaiMyNeural` |
| `VIETNAMESE_API_KEY`, `VIETNAMESE_VOICEID` | LucyLab (có trả file SRT) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | ElevenLabs; tiếng Việt cần `eleven_v3` hoặc `eleven_flash_v2_5` |
| `VBEE_APP_ID`, `VBEE_ACCESS_TOKEN`, `VBEE_VOICE_CODE` | Vbee; access token hết hạn định kỳ |
| `TIKTOK_DISPLAY_NAME`, `TIKTOK_HANDLE`, `TIKTOK_FOLLOWERS`, `TIKTOK_AVATAR_URL` | Thẻ follow ở outro; mặc định là Dan Tech Academy / `@dantech0xff` |
| `VIDEO_THEME` | `dark-neon` (mặc định) hoặc `light-pro` |
| `TTS_CONCURRENCY` | Số cảnh tổng hợp giọng song song (LucyLab chỉ cho 1) |

Ảnh đại diện trên thẻ follow lấy từ `TIKTOK_AVATAR_URL` nếu có, không thì dùng file
`assets/avatar.{jpg,png,webp}` đi kèm repo.

## Đầu ra

```text
output/<slug>-<timestamp>/
├── script.json          # kịch bản v1
├── script.txt           # lời thoại, dùng cho auto-caption của CapCut
├── caption.txt          # caption + 4 hashtag (skill viết)
├── images/bg.jpg        # og:image đã tải (nếu có)
├── voice/scene-*.mp3    # giọng từng cảnh; đã có thì không tổng hợp lại (kèm .srt với LucyLab/Edge)
├── voice-raw.mp3        # giọng đã nối, chưa có SFX
├── voice.mp3            # giọng + SFX
├── tiktok-avatar.*      # ảnh đại diện cho thẻ follow
├── index.html, styles.css, animations.js, hyperframes.json, meta.json   # composition HyperFrames
└── video.mp4            # 1080×1920, 30 fps
```

Muốn tổng hợp lại giọng một cảnh, xoá `voice/scene-<id>.mp3` rồi chạy lại `npm run pipeline`.

## Hình ảnh và nhịp

- Mỗi video có khung cố định (header thương hiệu, footer handle, nền gradient, grain) và 5–8 cảnh.
- Độ dài một cảnh bằng độ dài giọng của cảnh đó cộng 0,3 s; cảnh outro giữ thêm 3 s cho thẻ follow.
- Animation vào cảnh cố định theo template, xem [`animations.js`](../src/render/templates/animations.js).
- Tổng thời lượng ngoài khoảng 48–72 s thì pipeline chỉ cảnh báo, video vẫn được render.
- Tuỳ biến giao diện trong [`styles.css`](../src/render/templates/styles.css) (`dark-neon`) và
  [`styles.light-pro.css`](../src/render/templates/styles.light-pro.css) (`light-pro`).

## SFX

Thư viện nằm ở `assets/sfx/<nhóm>/<tên>.mp3` với các nhóm `transition`, `emphasis`, `alert`,
`success`, `fail`, `outro`, `reveal`, `drumroll`, `countdown`, `cinematic`. Mỗi cảnh được chọn
một SFX theo thứ tự:

1. `scene.sfx` ghi rõ trong kịch bản (`{ "name": "none" }` để tắt);
2. từ khoá trong `voiceText` (ví dụ `cảnh báo` → `alert`, `kỷ lục` → `success`, `ra mắt` → `reveal`);
3. nhóm mặc định của template.

Trong một nhóm, file được chọn cố định theo id của cảnh, nên render lại vẫn ra đúng âm đó. Logic
nằm trong [`src/assets/sfx-selector.ts`](../src/assets/sfx-selector.ts).

`npm run sfx:download` tải một thư viện lớn từ myinstants.com vào `SFX/` (không commit), còn
`npm run sfx:filter` chép các file ngắn sang `assets/sfx/`. Âm thanh tải kiểu này không rõ bản
quyền; với video đăng công khai, hãy dùng thư viện có license.

## Phát âm số

TTS tiếng Việt đọc số và ký hiệu theo mặt chữ, nên trong `voiceText` hãy viết thành chữ; các trường
hiển thị trong `templateData` vẫn giữ nguyên dạng số:

| Hiển thị | Viết trong `voiceText` |
|---|---|
| `GPT 5.5` | `GPT năm chấm năm` |
| `82.7%` | `tám mươi hai phẩy bảy phần trăm` |
| `1M tokens` | `một triệu token` |
| `200MP` | `hai trăm megapixel` |

## Xử lý sự cố

| Lỗi | Cách xử lý |
|---|---|
| `Missing VIETNAMESE_API_KEY` / `Missing ELEVENLABS_API_KEY` / `Missing VBEE_…` | Kiểm tra `.env.local` và `TTS_PROVIDER` |
| `Vbee 401 Unauthorized` | Lấy access token mới từ tài khoản Vbee |
| `LucyLab polling timeout` | Tăng `LUCYLAB_POLL_TIMEOUT_MS` (mặc định 120000) |
| `Total duration … outside [48, 72]s` | Chỉ là cảnh báo; muốn đúng khoảng thì viết lại kịch bản 150–200 từ, 5–8 cảnh |
| `hyperframes render failed` | Chạy `npx hyperframes render --help` để kiểm tra CLI và Chrome |
| `ffprobe: command not found` | Cài FFmpeg |

## Tài liệu lịch sử

Spec và plan gốc của pipeline này được lưu ở
[`docs/superpowers/specs/2026-04-29-auto-news-video-design.md`](superpowers/specs/2026-04-29-auto-news-video-design.md)
và [`docs/superpowers/plans/2026-04-29-auto-news-video.md`](superpowers/plans/2026-04-29-auto-news-video.md).
Hai file này mô tả thiết kế ban đầu và không còn được cập nhật.
