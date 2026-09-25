# Get Frames (app desktop)

App miễn phí để làm video bài giảng lập trình bằng AI agent đã cài trên máy. Bạn nhập chủ đề và tư liệu, agent (Claude Code) viết kịch bản và dựng storyboard bằng Studio tools. Sau đó bạn duyệt từng cảnh, ghi chú cho agent sửa, rồi render video 16:9 và 9:16 kèm bộ file đăng bài.

Đây là bản MVP của giai đoạn 1 ([kiến trúc và lộ trình](../docs/dan-tech/2026-09-25-desktop-app-architecture.md)): chạy trên macOS chip Apple, có bản Windows build thử trong CI, agent là Claude Code.

## Cần có

- **Claude Code** đã cài và đăng nhập: chạy `claude` trong Terminal một lần ([hướng dẫn cài](https://docs.claude.com/en/docs/claude-code/setup)).
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

## Chạy từ mã nguồn

```bash
cd desktop
npm run dev                  # Electron + Vite, giao diện tự nạp lại khi sửa
```

Bản dev dùng thư mục dữ liệu riêng (`Get Frames Dev`) để không đụng vào dữ liệu của bản cài. Khi sửa engine (`src/` ở gốc repo), chạy lại `npm run build` ở gốc.

## Dùng app

1. **Lần mở đầu:** tải Chrome headless, kiểm tra FFmpeg và Claude Code, chọn thư mục dự án (mặc định `~/Movies/Get Frames`).
2. **Tạo video:** chủ đề; loại video (bài giảng 16:9 kèm một Short, hoặc chỉ Short); tư liệu gồm file `.md`/`.txt`/`.pdf`, link bài viết (app tải trang và giữ nội dung chính) hoặc nội dung dán vào; style; giọng đọc.
3. **Agent:** app mở phiên Claude Code trong thư mục dự án và gửi yêu cầu. Tab Agent hiện từng bước. App tự cho phép việc đọc và sửa file trong dự án cùng Studio tools; lệnh shell, file ngoài dự án và truy cập mạng thì hỏi bạn.
4. **Storyboard:** xem từng cảnh (ảnh, lời thoại, thời gian), ghi chú theo cảnh rồi gửi cho agent sửa.
5. **Render:** chọn chất lượng rồi render. Máy không ngủ khi đang render, và app báo khi xong.
6. **Kết quả:** xem video, copy tiêu đề, mô tả, tags và chương, mở thư mục.

Hôm sau mở lại dự án, app nối tiếp phiên agent cũ (`session/resume`).

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
  - `claude-agent/agent.log`: adapter ACP.

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
4. Adapter ACP của Claude Code chạy được từ trong app.
5. `check_layout` qua MCP HTTP dựng storyboard có icon và code.

CI chạy bước này trên macOS và Windows, rồi giữ file `.dmg` và bộ cài `.exe` làm artifact.

## Mã nguồn

```text
desktop/
├── src/main/            main process
│   ├── agents/          ACP client, driver Claude Code, chính sách quyền, Agent Hub
│   ├── projects.ts      thư mục dự án, project.json, AGENTS.md, chép skill
│   ├── prompts.ts       yêu cầu đầu tiên, ghi chú storyboard gửi agent
│   ├── sources.ts       tư liệu vào sources/; web-page.ts tải link (Readability, Turndown)
│   ├── setup.ts         Chrome headless, FFmpeg, dò agent; locate.ts tìm file chạy
│   ├── settings.ts      settings.json và key (safeStorage)
│   ├── engine.ts        client của engine host; render.ts hàng đợi render
│   ├── media.ts         gf-media:// phục vụ ảnh và video cho giao diện
│   └── smoke.ts         --smoke-test
├── src/engine/          engine host (utility process): Studio tools, render, tải Chrome
├── src/preload/         window.getFrames
├── src/renderer/        giao diện React
├── src/shared/          kiểu dữ liệu và danh sách kênh IPC
├── scripts/stage-engine.mjs   chép engine đã build vào resources/engine
└── electron-builder.yml
```

## Giới hạn của bản MVP

- Chỉ có Claude Code. Codex, Devin và video tin tức làm ở giai đoạn 2.
- App chưa kèm FFmpeg, mà dùng bản cài trên máy.
- App chưa ký số: bản CI cần gỡ cờ cách ly như trên, còn Windows sẽ hiện cảnh báo SmartScreen.
- Trước khi phát hành cho người khác còn các việc pháp lý ở [mục 11 của tài liệu thiết kế](../docs/dan-tech/2026-09-25-desktop-app-architecture.md#11-license-điều-khoản-và-rủi-ro). Trong đó có chính sách của Anthropic về đăng nhập Claude trong app bên thứ ba.
