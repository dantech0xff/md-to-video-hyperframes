# Studio tools: cho agent tạo bài trong terminal

Studio tools là MCP server mà app Get Frames sẽ gắn vào phiên làm việc của agent ([kiến trúc](2026-09-25-desktop-app-architecture.md#5-studio-tools)). Trước khi có app, bạn chạy thử được ngay trong terminal với Claude Code hoặc Codex: agent làm việc trong một thư mục dự án, viết `script.json` và gọi các tool dưới đây thay cho `npm run lesson:*`.

| Tool | Việc |
|---|---|
| `validate_script` | Kiểm tra `script.json` theo schema v2: lỗi kèm đường dẫn, brand hoặc style không tồn tại, thời lượng ước tính |
| `check_layout` | Như `npm run lesson:frames`: storyboard từ thời gian ước tính, không TTS, khoảng 10 giây |
| `build_storyboard` | Như `npm run lesson:storyboard`: giọng đọc thật, trộn âm thanh, storyboard, `chapters.txt` |
| `wait_job` | Chờ tiếp một job trả về `"status": "running"` (mỗi lần gọi tool chờ tối đa 45 giây) |
| `list_catalog` | Style, brand kit, giọng dùng được, tên file SFX và nhạc trong thư viện |

Tool không render. Mọi đường dẫn trong kết quả đều tính từ thư mục dự án, và tool từ chối mọi đường dẫn nằm ngoài thư mục đó. Ảnh trong kịch bản (`image`, `media`, `avatar`…) cũng vậy: phải là file trong thư mục dự án, không phải link. Lexicon chỉ gọi bằng tên (`tech-vi`). Cảnh báo có mã (`unknown-cue`, `no-sfx-match`, `punch-too-long`, `music-not-found`…); bảng cách sửa nằm trong phần "App mode" của [skill](../../.agents/skills/create-lesson-video/SKILL.md#app-mode-get-frames).

## 1. Chuẩn bị (một lần)

```bash
cd md-to-video-hyperframes
npm ci
npm run build      # tạo dist/studio/cli.js
npm run env:check
export REPO="$PWD"
```

Server đọc key và cấu hình giọng từ `.env.local` của repo, giống `npm run lesson`.

## 2. Tạo thư mục dự án

Đây là việc app sẽ tự làm:

```bash
mkdir -p ~/Movies/"Get Frames"/kotlin-flow/sources && cd ~/Movies/"Get Frames"/kotlin-flow
cp ~/notes/kotlin-flow.md sources/                        # tư liệu
mkdir -p .agents/skills .claude/skills
cp -R "$REPO/.agents/skills/create-lesson-video" .agents/skills/   # Codex, Devin, Antigravity
cp -R "$REPO/.agents/skills/create-lesson-video" .claude/skills/   # Claude Code
```

## 3a. Claude Code

```bash
cat > studio.mcp.json <<EOF
{ "mcpServers": { "studio": { "command": "node", "args": ["$REPO/dist/studio/cli.js", "--project", "$PWD"] } } }
EOF
claude --mcp-config studio.mcp.json
```

Gõ `/mcp` để kiểm tra server `studio` đã kết nối, rồi gửi prompt ở [mục 4](#4-prompt). Chạy không tương tác:

```bash
claude -p "$(cat prompt.txt)" --mcp-config studio.mcp.json --allowedTools "mcp__studio,Read,Write,Edit"
```

## 3b. Codex

```bash
codex \
  -c 'mcp_servers.studio.command="node"' \
  -c "mcp_servers.studio.args=[\"$REPO/dist/studio/cli.js\", \"--project\", \"$PWD\"]" \
  -c 'mcp_servers.studio.default_tools_approval_mode="approve"'
```

Dòng `default_tools_approval_mode` là bắt buộc với `codex exec`: ở chế độ không tương tác, Codex từ chối mọi tool MCP cần duyệt, và `build_storyboard` cần duyệt vì nó gọi dịch vụ TTS. Chạy không tương tác thì thay `codex` bằng `codex exec --skip-git-repo-check --sandbox workspace-write "$(cat prompt.txt)"`, giữ nguyên các dòng `-c`.

## 4. Prompt

```text
Làm theo skill .agents/skills/create-lesson-video/SKILL.md, phần "App mode".
Yêu cầu: bài giảng 16:9 kèm Shorts 9:16, style blueprint, giọng free.
Tư liệu: sources/kotlin-flow.md
Dùng Studio tools để kiểm tra và dựng storyboard. Không render.
Dừng khi storyboard hết lỗi và đã viết youtube.md.
```

Agent viết `script.json` và `youtube.md` ở gốc thư mục dự án, còn storyboard nằm ở `landscape/storyboard.jpg` và `portrait/storyboard.jpg`. Chưa có app thì render bằng lệnh của repo:

```bash
cd "$REPO" && npm run lesson -- ~/Movies/"Get Frames"/kotlin-flow/script.json
```

## 5. Qua HTTP, giống app

```bash
npm run studio -- --http --project ~/Movies/"Get Frames"/kotlin-flow
```

Lệnh in ra URL (`http://127.0.0.1:<cổng>/mcp`), một Bearer token cho dự án đó và lệnh `claude mcp add` tương ứng. Request thiếu token hoặc sai token nhận `401`.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `validate_script` báo `script.json does not exist` | Agent ghi file ở chỗ khác: kiểm tra `--project` trỏ đúng thư mục mà agent đang làm việc |
| Codex: `MCP tool call requires approval, but approval policy is never` | Thêm dòng `default_tools_approval_mode="approve"` như ở mục 3b |
| Claude Code không thấy tool | `/mcp` để xem trạng thái; server ghi log ra stderr, nên chạy thử `node "$REPO/dist/studio/cli.js" --project .` để xem lỗi |
| `check_layout` báo không tìm thấy Chrome | Chạy `npx hyperframes browser ensure` trong repo hoặc đặt `CHROME_PATH` trong `.env.local` |
