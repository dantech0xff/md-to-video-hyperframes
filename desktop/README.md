# Get Frames (app desktop)

App miễn phí để làm video bài giảng lập trình và bản tin công nghệ bằng AI agent đã cài trên máy. Bạn nhập chủ đề và tư liệu, agent (Claude Code, Codex hoặc Devin) viết kịch bản và dựng storyboard bằng Studio tools. Sau đó bạn duyệt từng cảnh, ghi chú cho agent sửa, rồi render video 16:9 và 9:16 kèm bộ file đăng bài.

Đây là bản MVP của giai đoạn 1, thêm driver Codex, Devin và bản tin 9:16 của giai đoạn 2 ([kiến trúc và lộ trình](../docs/dan-tech/2026-09-25-desktop-app-architecture.md)): chạy trên macOS chip Apple, có bản Windows build thử trong CI.

## Cần có

- **Một AI agent** đã cài và đăng nhập (mỗi video chọn một agent):
  - **Claude Code**: chạy `claude` trong Terminal một lần ([hướng dẫn cài](https://docs.claude.com/en/docs/claude-code/setup)).
  - **Codex**: cài theo [hướng dẫn](https://developers.openai.com/codex/cli), rồi chạy `codex login`.
  - **Devin**: cài theo [hướng dẫn](https://docs.devin.ai/cli), rồi chạy `devin auth login`.
- **FFmpeg**: `brew install ffmpeg` (Windows: `winget install Gyan.FFmpeg`). App tự tìm; nếu không thấy thì chọn file trong app.
- **Chrome headless**: app tải ở lần mở đầu (khoảng 100 MB, đúng bản HyperFrames cần), không cần làm gì trước.
- Build từ mã nguồn: Node 22.

## Build và cài trên Mac

```bash
cd md-to-video-hyperframes
npm ci && npm run build      # engine: dist/ mà app nạp
cd desktop
npm ci
npm run dist:mac             # release/Get-Frames-<version>-mac-arm64.dmg
```

Mở file `.dmg`, kéo Get Frames vào Applications. Bản build trên chính máy bạn mở được ngay. Bản tải từ artifact của CI chưa ký Developer ID, nên macOS báo "đã hỏng"; gỡ cờ cách ly một lần:

```bash
xattr -dr com.apple.quarantine "/Applications/Get Frames.app"
```

Các bước thử trọn một bài trên Mac nằm trong [checklist nghiệm thu giai đoạn 1](../docs/dan-tech/2026-10-03-phase1-acceptance-checklist.md).

## Chạy từ mã nguồn

```bash
cd desktop
npm run dev                  # Electron + Vite, giao diện tự nạp lại khi sửa
```

Bản dev dùng thư mục dữ liệu riêng (`Get Frames Dev`) để không đụng vào dữ liệu của bản cài. Khi sửa engine (`src/` ở gốc repo), chạy lại `npm run build` ở gốc.

## Dùng app

1. **Lần mở đầu:** tải Chrome headless, kiểm tra FFmpeg và các agent (Claude Code, Codex, Devin: phiên bản, đăng nhập, agent mặc định), chọn thư mục dự án (mặc định `~/Movies/Get Frames`).
2. **Tạo video:** chủ đề; loại video (bài giảng 16:9 kèm một Short, chỉ Short, hoặc bản tin 9:16); tư liệu gồm file `.md`/`.txt`/`.pdf`, ảnh (`.jpg`/`.png`/`.webp`), link bài viết (app tải trang và giữ nội dung chính) hoặc nội dung dán vào; brand kit; style; giọng đọc; agent. Bản tin bắt buộc có tư liệu có chữ (link, file `.md`/`.txt`/`.pdf` hoặc nội dung dán vào; ảnh chỉ đi kèm): agent chỉ dùng thông tin trong đó và ghi nguồn cho từng con số.
3. **Agent:** app mở phiên của agent đã chọn trong thư mục dự án và gửi yêu cầu. Tab Agent hiện từng bước. App tự cho phép việc đọc và sửa file trong dự án cùng Studio tools; lệnh shell, file ngoài dự án và truy cập mạng thì hỏi bạn. Riêng Codex tự chạy lệnh và sửa file trong dự án bên trong sandbox của nó, và chỉ hỏi khi cần ra ngoài sandbox.
4. **Storyboard:** xem từng cảnh (ảnh, lời thoại, thời gian), ghi chú theo cảnh rồi gửi cho agent sửa. Những thay đổi sau thì không cần agent:
   - **Sửa** trên một cảnh, thẻ chương hay outro: form sửa chữ, lời thoại, số liệu. Ở dòng intro, **Sửa** chọn chỗ phát sting của brand.
   - Bấm vào lời thoại để sửa ngay trên dòng. Ô sửa giữ nguyên cue như `{1}` hay `{pause:2}`. Bấm Esc hoặc **Huỷ** để bỏ.
   - Nút trên mỗi dòng:
     - chuyển lên, chuyển xuống: cảnh chuyển trong chương hoặc sang chương bên cạnh, chương đổi chỗ với chương bên cạnh. Chuyển cảnh duy nhất của một chương ra ngoài thì chương đó mất theo, nên app hỏi trước;
     - nhân bản cảnh (id mới, thêm `-copy`);
     - xoá: cảnh bị bỏ khỏi kịch bản, còn thẻ chương, intro và outro chỉ bị tắt. Intro và outro đã tắt vẫn hiện trong danh sách, với nhãn "tắt", để bật lại trong **Sửa** (outro: trường "Hiện outro").
   - **Thêm cảnh** ở cuối mỗi chương, **Thêm chương** ở cuối kịch bản, với kiểu cảnh chọn trong danh sách.

   App kiểm tra rồi mới lưu `script.json`, sau đó dựng lại storyboard và báo agent ở tin nhắn sau. Nếu kịch bản đã bị sửa ở nơi khác trong lúc đó, app không ghi đè. Không sửa được khi agent đang làm việc. Ghi chú bạn đã viết cho một cảnh hay thẻ chương vẫn đi theo đúng phần đó khi thứ tự thay đổi.
5. **Render:** chọn chế độ rồi render:
   - **Xem trước:** HD, 30 fps, render thô cho nhanh.
   - **Chuẩn:** Full HD, 30 fps.
   - **Ultra:** 2K, 60 fps. App render 4K rồi thu nhỏ, nên hình nét hơn nhưng chậm hơn nhiều.

   Nút **Lời thoại** của mỗi video liệt kê những câu TTS sẽ đọc (đã bỏ cue), để đọc lại và sửa ngay trước khi render. Render đang chạy hay đang chờ đều huỷ được, ở tab Render hoặc ở thanh bên trái. Máy không ngủ khi đang render, và app báo khi xong.
6. **Kết quả:** xem video, copy tiêu đề, mô tả, tags và chương, mở thư mục.

Hôm sau mở lại dự án, app nối tiếp phiên agent cũ (`session/resume`).

**Xoá dự án:** nút thùng rác trên thẻ dự án hoặc ở đầu màn hình dự án. Thư mục dự án chuyển vào Thùng rác nên vẫn khôi phục được. App không xoá khi agent đang làm việc, hay dự án đang render hoặc dựng storyboard.

**Thư viện** (thanh bên trái): brand kit và âm thanh dùng cho mọi video trên máy.

- **Brand kit:** tên, tagline, website, handle, lời kêu gọi ở outro (16:9 và 9:16), wordmark bằng chữ có màu riêng, logo PNG cho nền tối và nền sáng, style mặc định và nhân vật (robot có sẵn hoặc ảnh của bạn theo từng tư thế). Tạo kit trống hoặc từ một kit có sẵn. Kit đi kèm app không sửa trực tiếp: bấm **Tuỳ chỉnh** để có bản riêng cùng id, thay cho bản đi kèm trong mọi video. Kit đặt làm **Mặc định** được chọn sẵn khi tạo video.
- **Âm thanh:** hiệu ứng và nhạc nền theo thư mục, nghe thử, thêm file, đổi tên, chuyển vào thùng rác. Engine chọn âm thanh theo tên file, nên bảng "Style dùng âm thanh nào" cho biết mỗi lúc (chuyển cảnh, hiện nội dung, trả lời đúng…) sẽ dùng file nào. Chưa có file nào hợp thì engine dùng bộ âm thanh mẫu tự tạo.

## Dữ liệu và log

| | macOS | Windows |
|---|---|---|
| Dự án | `~/Movies/Get Frames/` | `%USERPROFILE%\Videos\Get Frames\` |
| Dữ liệu app | `~/Library/Application Support/Get Frames/` | `%APPDATA%\Get Frames\` |

Trong thư mục dữ liệu app:
- `settings.json`: cài đặt.
- `secrets.bin`: key giọng đọc, mã hoá bằng Keychain/DPAPI.
- `browsers/`: Chrome headless.
- `brands/`: brand kit của bạn.
- `sounds/sfx/`, `sounds/music/`: thư viện âm thanh.
- `logs/`:
  - `main.log`: app.
  - `engine.log`: storyboard và render.
  - `agent.log`: phiên agent và các quyền app đã tự cho phép.
  - `agents/claude-code/`, `agents/codex/`: log của adapter ACP.

## Kiểm tra

```bash
npm run typecheck
npm test                     # cần engine đã build ở gốc repo
npm run dist:dir             # đóng gói cho máy đang dùng, không tạo bộ cài
"release/mac-arm64/Get Frames.app/Contents/MacOS/Get Frames" --smoke-test
```

`--smoke-test` kiểm tra bản đã đóng gói mà không cần đăng nhập agent:
1. Engine host khởi động và nạp engine.
2. Cửa sổ và cầu nối IPC hoạt động.
3. Một trang web (có phần do JavaScript thêm vào) thành Markdown.
4. Adapter ACP của Claude Code và của Codex chạy được từ trong app.
5. `check_layout` qua MCP HTTP dựng storyboard có icon và code.

CI chạy bước này trên macOS và Windows, rồi giữ file `.dmg` và bộ cài `.exe` làm artifact.

## Mã nguồn

```text
desktop/
├── src/main/            main process
│   ├── agents/          ACP client, driver Claude Code, Codex và Devin, chính sách quyền, Agent Hub
│   ├── projects.ts      thư mục dự án, project.json, AGENTS.md, chép skill
│   ├── prompts.ts       yêu cầu đầu tiên, ghi chú storyboard gửi agent
│   ├── sources.ts       tư liệu vào sources/; web-page.ts tải link (Readability, Turndown)
│   ├── setup.ts         Chrome headless, FFmpeg, dò agent; locate.ts tìm file chạy
│   ├── settings.ts      settings.json và key (safeStorage)
│   ├── engine.ts        client của engine host; render.ts hàng đợi render; storyboards.ts storyboard app tự dựng sau khi sửa
│   ├── media.ts         gf-media:// phục vụ ảnh và video cho giao diện
│   └── smoke.ts         --smoke-test
├── src/engine/          engine host (utility process): Studio tools, render, tải Chrome
├── src/preload/         window.getFrames
├── src/renderer/        giao diện React; components/SchemaForm.tsx form sửa kịch bản sinh từ JSON Schema, components/InlineVoice.tsx sửa lời thoại ngay trên dòng
├── src/shared/          kiểu dữ liệu và danh sách kênh IPC
├── scripts/stage-engine.mjs   chép engine đã build vào resources/engine
├── stubs/openai-codex/  gói rỗng thay bản Codex kèm adapter Codex (app chạy codex bạn đã cài)
└── electron-builder.yml
```

## Giới hạn của bản MVP

- Driver Devin chưa chạy được một lượt thật (cần tài khoản Devin); Codex đã chạy thật với một model giả.
- Bản tin chưa tự lấy ảnh đầu bài khi tải link: thêm ảnh bằng file.
- App chưa kèm FFmpeg, mà dùng bản cài trên máy.
- App chưa ký số: bản CI cần gỡ cờ cách ly như trên, còn Windows sẽ hiện cảnh báo SmartScreen.
- Trước khi phát hành cho người khác còn các việc pháp lý ở [mục 11 của tài liệu thiết kế](../docs/dan-tech/2026-09-25-desktop-app-architecture.md#11-license-điều-khoản-và-rủi-ro). Trong đó có chính sách của Anthropic về đăng nhập Claude trong app bên thứ ba.
