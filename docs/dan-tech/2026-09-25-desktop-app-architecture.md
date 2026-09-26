# Get Frames: kiến trúc và lộ trình app desktop

> **Ngày:** 2026-09-25
> **Trạng thái:** đã chốt hướng đi (mục 1). Giai đoạn 0 xong. Giai đoạn 1 đã code xong trong `desktop/` ([hướng dẫn](../../desktop/README.md)): app chạy thật được qua Setup, tạo dự án, đọc link, duyệt storyboard và render, và CI build thử xanh trên macOS và Windows. Còn lại của giai đoạn 1: Dan Tech làm trọn một bài trên Mac với Claude Code thật. Giai đoạn 2 đã có driver Codex và Devin, bản tin 9:16, và form sửa kịch bản không cần agent ([mục 12](#12-lộ-trình)).
> **Câu hỏi:** đóng gói hai skill `create-lesson-video` và `create-news-video` thành một app desktop thế nào, để người dùng mở app, kết nối với AI agent đã cài trên máy (Claude Code, Codex, Devin) và tạo video, rồi phát hành miễn phí cho người khác?

---

## 0. Tóm tắt nhanh

- **Get Frames** là app Electron miễn phí. Làm cho macOS (chỉ Mac chip Apple) trước, nhưng mọi quyết định kỹ thuật phải chạy được trên cả macOS và Windows. Engine hiện tại chạy bên trong app như một thư viện.
- **Chia việc:** agent chỉ làm phần sáng tạo (đọc tư liệu, viết và sửa `script.json`, soạn `youtube.md`). App làm phần tất định (kiểm tra, storyboard, render) và các bước duyệt của người dùng. Render mất khoảng 5–6 lần thời lượng video, không để agent ngồi chờ.
- **Một giao thức cho mọi agent: ACP** (Agent Client Protocol). Devin CLI hỗ trợ sẵn (`devin acp`); Claude Code và Codex đi qua adapter mã nguồn mở Apache-2.0. Antigravity để sau vì điều khoản của Google.
- **Studio tools:** một MCP server do app chạy, để agent kiểm tra kịch bản, dựng storyboard và tra danh mục. Agent không cần Node, không cần `npm run`, không cần quyền chạy shell.
- **Giọng đọc:** người dùng tự nhập key cho giọng trả phí hoặc giọng clone; giọng free Edge TTS giữ như hiện tại.
- **Mã nguồn:** làm trong repo này, public giai đoạn đầu, đóng nguồn sau.
- **Trước khi phát hành cho người khác** còn phải xử lý chính sách của Anthropic về gói Claude, bản FFmpeg đi kèm và việc ký số app. App miễn phí không làm mất các nghĩa vụ này. **Trước khi đóng nguồn** phải thay thư viện Edge TTS (AGPL-3.0). Chi tiết ở [mục 11](#11-license-điều-khoản-và-rủi-ro).

---

## 1. Quyết định đã chốt

| Chủ đề | Quyết định | Ai chốt |
|---|---|---|
| Tên sản phẩm | Get Frames; bundle id `academy.dantech.getframes` | Dan Tech (bundle id: đề xuất) |
| Người dùng | Dan Tech dùng đầu tiên; phát hành cho người khác khi hoàn thiện | Dan Tech |
| Giá | Miễn phí 100%: không có license key, không có thanh toán | Dan Tech |
| Dạng sản phẩm | App desktop, mở lên là chạy | Dan Tech |
| Agent | Claude Code, Codex, Devin trước; Antigravity sau | Dan Tech |
| Hệ điều hành | macOS cho MVP; thiết kế cho cả macOS và Windows ngay từ đầu | Dan Tech |
| Mac chip Intel | Không hỗ trợ: bản macOS chỉ build arm64 | Dan Tech |
| Giọng đọc | Người dùng tự nhập key (ElevenLabs, LucyLab, Vbee…); giữ giọng free Edge TTS như repo hiện tại | Dan Tech |
| Mã nguồn | Làm trong repo này; public giai đoạn đầu, đóng nguồn sau | Dan Tech |
| Vỏ app | Electron ([mục 2](#2-kiến-trúc-tổng-thể)) | đề xuất |
| Giao thức với agent | ACP ([mục 4](#4-kết-nối-agent)) | đề xuất |
| Công cụ cho agent | Studio tools, một MCP server ([mục 5](#5-studio-tools)) | đề xuất |

---

## 2. Kiến trúc tổng thể

```
Renderer (giao diện)
  dự án · tạo video · agent đang làm gì · duyệt storyboard · render · bộ file đăng bài · cài đặt
      │ IPC
      ▼
Main process
  ├─ Project manager   thư mục dự án, project.json, chép skill và AGENTS.md
  ├─ Agent Hub         ACP client ─ stdio ─► claude-agent-acp ─► Claude Code
  │                                ─ stdio ─► codex-acp ────────► codex (bản user đã cài)
  │                                ─ stdio ─► devin acp
  ├─ Settings          key giọng đọc (safeStorage), đường dẫn FFmpeg và Chrome
  └─ Setup             dò agent đã cài, tải Chrome headless ở lần mở đầu
      │ MessagePort
      ▼
Engine host (utilityProcess, chạy bằng Node của Electron)
  ├─ Studio tools      MCP server HTTP trên 127.0.0.1   ◄── agent gọi
  ├─ Job runner        storyboard · preview · render, mỗi lúc một job nặng
  └─ Engine (src/)     ─► hyperframes CLI ─► Chrome headless · FFmpeg
```

**Vì sao Electron.** Engine viết bằng Node/TypeScript. Electron có sẵn Node, nên engine chạy trực tiếp trong một `utilityProcess` mà không phải kèm thêm runtime. Electron cũng có sẵn những thứ app cần: `safeStorage` để lưu key (Keychain trên macOS, DPAPI trên Windows), `powerSaveBlocker` để máy không ngủ khi đang render, electron-builder để đóng gói DMG/NSIS, electron-updater để tự cập nhật. Tauri nhẹ hơn nhưng vẫn phải kèm một bản Node riêng để chạy engine.

**Vì sao tách engine host.** Render ngốn CPU trong nhiều phút; chạy ở tiến trình riêng thì giao diện không bị đơ. Muốn huỷ thì dừng tiến trình, và engine có lỗi cũng không kéo sập cả app.

---

## 3. Luồng làm một video

1. **Tạo dự án (giao diện).** Người dùng nhập chủ đề, chọn file `.md`/`.txt` hoặc dán URL. Sau đó chọn loại video (bài giảng 16:9 kèm Shorts, Shorts riêng, tin tức 9:16), style, giọng đọc và agent.
2. **Chuẩn bị (app).**
   - Tạo thư mục dự án ([mục 7](#7-dữ-liệu-trên-máy-người-dùng)).
   - Tư liệu được đưa vào `sources/`. Với URL, app mở trang bằng Chromium của Electron, trích nội dung chính (Readability) rồi lưu thành file, nên đọc được cả trang render bằng JavaScript. Agent chỉ cần đọc file: không cần quyền mạng, và mọi agent xử lý giống nhau.
   - Chép skill cùng `AGENTS.md`/`CLAUDE.md` vào thư mục dự án ([mục 6](#6-skill-cho-app)), rồi ghi `project.json`.
3. **Viết kịch bản (agent).**
   - App mở phiên ACP: `session/new` với `cwd` là thư mục dự án và `mcpServers` là Studio tools. Sau đó app gửi `session/prompt` chứa yêu cầu đã điền sẵn.
   - Agent đọc skill và tư liệu, rồi viết `script.json`. Tiếp theo agent gọi `check_layout`, sau đó `build_storyboard`, tự mở ảnh storyboard ra soát và sửa đến khi hết lỗi và cảnh báo. Cuối cùng agent soạn `youtube.md`; lúc này đã có `chapters.txt` vì engine ghi file đó khi dựng storyboard.
   - App biến luồng `session/update` (tin nhắn, tool call, plan) thành danh sách bước dễ đọc.
4. **Duyệt (người dùng).**
   - App hiện storyboard theo từng cảnh: ảnh, lời thoại, thời lượng. Người dùng ghi chú cho từng cảnh hoặc cho cả bài. App gửi ghi chú, kèm id cảnh, thành một `session/prompt` mới trong cùng phiên. Agent sửa xong thì app cập nhật storyboard.
   - Sửa nhỏ (chữ, lời thoại, số liệu) người dùng tự làm trong form của cảnh. App ghi `script.json`, dựng lại storyboard mà không cần agent, và báo agent ở tin nhắn sau.
   - Muốn xem chuyển động của một đoạn, app tự chạy job preview; bước này không cần agent.
5. **Render (app).** Job runner có hàng đợi, phần trăm tiến trình và nút huỷ, giữ máy không ngủ và báo khi xong. Các định dạng được render lần lượt.
6. **Kết quả (giao diện).** Xem video, copy từng phần của `youtube.md`, lấy phụ đề và danh sách chương, mở thư mục trong Finder hoặc Explorer.

App lưu id phiên của agent trong `project.json`. Hôm sau mở lại dự án, nếu agent hỗ trợ `session/load` thì app nối tiếp phiên cũ. Nếu không, app mở phiên mới và dẫn agent đọc `script.json` hiện có.

---

## 4. Kết nối agent

### 4.1 Vì sao ACP

ACP là giao thức JSON-RPC giữa trình soạn thảo và agent, do Zed khởi xướng; Zed và JetBrains đang dùng. Một phiên làm việc gồm các bước:

```
initialize → session/new (cwd, mcpServers) → session/prompt
  ◄── session/update           (agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan)
  ◄── session/request_permission (app trả lời theo chính sách quyền)
  ──► session/cancel
```

- **Devin:** `devin acp` là cách duy nhất để app theo dõi tiến trình, vì `devin -p` không có output JSON và chỉ trả kết quả khi chạy xong.
- **Claude Code và Codex:** có adapter chính thức trong tổ chức `agentclientprotocol`, license Apache-2.0, vẫn đang được cập nhật đều. Nhờ đó app không phải chạy theo các thay đổi của từng CLI. Riêng Codex ra bản mới hằng tuần và hay bỏ tính năng cũ: `--full-auto` đã deprecated, `codex mcp-server` bị gỡ ở bản 0.154.0 ngày 2026-09-05.
- **ACP gắn được MCP server vào từng phiên** (`session/new.mcpServers`), nên Studio tools được đưa cho mọi agent theo cùng một cách.
- **Phương án dự phòng** khi adapter chậm cập nhật:
  - Claude Code: `claude -p --output-format stream-json --input-format stream-json --verbose`.
  - Codex: `codex exec --json`, nối phiên bằng `codex exec resume <id>`.

### 4.2 Từng agent

| | Claude Code | Codex | Devin |
|---|---|---|---|
| Kết nối | `@agentclientprotocol/claude-agent-acp`, chạy bằng Node của Electron; `CLAUDE_CODE_EXECUTABLE` trỏ tới bản user đã cài | `@agentclientprotocol/codex-acp`, chạy bằng Node của Electron; `CODEX_PATH` trỏ tới bản user đã cài | `devin acp` |
| Dò cài đặt | `claude --version`; `claude auth status --json` | `codex --version`; `codex login status` (exit 0 là đã đăng nhập; chữ in ra stderr) | `devin --version`; `devin auth status` (luôn exit 0: dòng đầu là `Not logged in.` hoặc `Logged in (via …)`) |
| Đăng nhập | Gói Claude của user, hoặc `ANTHROPIC_API_KEY` | ChatGPT Plus/Pro/Business, hoặc API key (`codex login`) | `devin auth login`, hoặc `WINDSURF_API_KEY` |
| Skill đọc từ | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` |
| Hướng dẫn chung | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| Chế độ app giữ ([mục 4.4](#44-quyền-của-agent)) | `default` ("Manual"); cho phép chuyển sang `plan` | `read-only` ("Ask for approval": sandbox `workspace-write`, không có mạng) | `accept-edits` ("Code"); cho phép `ask`, `plan` |
| Cấu hình trong dự án khiến app không mở agent | `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json` | `.codex/` | `.devin/`, `.windsurf/`, `.mcp.json`, `.cursor/mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`, `.claude/mcp_servers.json` |
| Lưu ý | Chính sách của Anthropic ([mục 11](#11-license-điều-khoản-và-rủi-ro)). Bản Claude Code đi kèm Agent SDK không đưa vào app | Tự chạy lệnh và sửa file trong dự án mà không hỏi; sandbox chặn phần còn lại. Tool MCP nằm sau `tool_search`, và mỗi lần gọi đều xin duyệt | Trên Windows, sandbox của Devin CLI cần WSL 2. Chưa chạy được một lượt thật (ghi chú giai đoạn 2) |

**Antigravity (để sau).** Chạy được bằng `agy -p --output-format stream-json`, không hỗ trợ ACP. Google ghi trong FAQ rằng dùng công cụ bên thứ ba để truy cập Antigravity là vi phạm điều khoản, và đã từng khoá tài khoản vì việc này. Nếu làm thì chỉ hỗ trợ Gemini API key.

**Gọi skill.** Prompt nêu thẳng đường dẫn `SKILL.md`, nên agent nào cũng làm theo được mà không phụ thuộc cú pháp gọi skill riêng (`/tên-skill` của Claude Code, `$tên-skill` của Codex). Prompt mẫu:

```
Bạn đang chạy trong app Get Frames.
Làm theo skill .agents/skills/create-lesson-video/SKILL.md, phần "Chế độ app".
Yêu cầu: bài giảng 16:9 kèm Shorts 9:16, style blueprint, giọng free.
Tư liệu: sources/kotlin-flow.md
Dùng Studio tools để kiểm tra và dựng storyboard. Không render.
Dừng khi storyboard hết lỗi và đã viết youtube.md.
```

### 4.3 Giao diện driver trong app

Mỗi agent là một driver trong `desktop/src/main/agents/`: tìm và kiểm tra chương trình user đã cài, và cách khởi động nó như một agent ACP. ACP client (`acp.ts`), Agent Hub và chính sách quyền dùng chung cho cả ba.

```ts
interface AgentDriver {
  detect(pathValue: string, override: string): Promise<AgentStatus>; // đã cài? phiên bản? đã đăng nhập?
  launch(o: { program: string; cwd: string; pathValue: string; logsDir: string }): Launch;
}

interface Launch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  sessionMeta?: Record<string, unknown>; // _meta của session/new (Claude Code: không cho bypass)
  mode?: { start: string; allowed: string[] }; // chế độ quyền app giữ phiên ở đó
}
```

Mỗi agent báo tool MCP trong yêu cầu quyền theo một kiểu, nên `acp.ts` đọc cả ba kiểu rồi đưa cho chính sách quyền cùng một dạng (server, tool, có phải server app truyền vào không):

- **Claude Code:** tool `mcp__<server>__<tool>`, kèm nơi cấu hình server (`dynamic` là server app truyền vào phiên).
- **Codex:** yêu cầu duyệt chỉ nêu id của tool call (`_meta.is_mcp_tool_approval`); tool call trước đó nêu `{ server, tool, arguments }`.
- **Devin:** tool `mcp_call_tool` với `{ server_name, tool_name, arguments }` (lấy từ file chạy của Devin, chưa thấy trong một lượt thật).

### 4.4 Quyền của agent

| Hành động | Mặc định |
|---|---|
| Đọc, tạo, sửa file trong thư mục dự án | Tự cho phép |
| Sửa file cấu hình agent hoặc file của app trong dự án (`.claude/`, `.codex/`, `.devin/`, `.windsurf/`, `.cursor/`, `.mcp.json`, `.git/`, `.agents/`, `.getframes/`, `project.json`, `AGENTS.md`, `CLAUDE.md`) | Hỏi người dùng: settings có thể chứa hook, quyền và MCP server, đều chạy được lệnh |
| Gọi Studio tools (đúng 5 tool của server `getframes` app truyền vào phiên) | Tự cho phép khi agent cho biết lời gọi đi tới server app truyền vào: Claude Code báo nguồn `dynamic`; Codex và Devin nêu tên server, và server của app thắng server cùng tên trong cấu hình của user. Không rõ server nào (ví dụ bản Claude Code cũ không báo nguồn) thì hỏi người dùng, vì server khác cùng tên cũng có tool trùng tên |
| Chạy lệnh shell | Hỏi người dùng (hộp thoại trong app) |
| Mở sub-agent (Agent, Task) | Hỏi người dùng: app không biết sub-agent sẽ được giao việc gì; danh sách việc (TodoWrite…) thì tự cho phép |
| Đọc hoặc ghi ngoài thư mục dự án | Hỏi người dùng |
| Truy cập mạng | Hỏi người dùng (thường không cần, vì app đã tải tư liệu vào `sources/`) |
| Chế độ quyền của agent | App giữ phiên ở chế độ agent hỏi app ([bảng 4.2](#42-từng-agent)). Phiên mở ra ở chế độ khác (do settings của user), hoặc agent tự chuyển sang chế độ tự quyết (auto, bypass, full access…), thì app đưa về; agent không chịu về thì app không dùng phiên đó, hoặc dừng agent nếu đang chạy |

App trả lời `session/request_permission` theo bảng này. Riêng Codex tự quyết một phần trước khi hỏi: sandbox `workspace-write` cho nó chạy lệnh và sửa file trong thư mục dự án (và thư mục tạm) mà không hỏi, nên app không thấy các việc đó. Ghi ra ngoài, dùng mạng hay xin chạy ngoài sandbox thì Codex mới hỏi app. Sandbox không chặn việc đọc file ngoài dự án. Cấu hình Codex tự tạo trong dự án (`.codex/`) chỉ bị phát hiện ở lần mở phiên sau.

---

## 5. Studio tools

MCP server chạy trong engine host, dùng transport Streamable HTTP tại `http://127.0.0.1:<cổng ngẫu nhiên>/mcp`.

- **Token theo phiên:** mỗi phiên có một bearer token riêng, truyền qua `headers` trong `session/new`. Mỗi token gắn với đúng một thư mục dự án, nên tool không chạm được vào dự án khác.
- **Agent không hỗ trợ HTTP:** nếu agent báo `mcpCapabilities.http = false` khi `initialize`, app cho phiên đó chạy Studio tools qua stdio (`dist/studio/cli.js --project <thư mục>`). Khi đó job chạy trong tiến trình riêng của phiên, không qua job runner chung của app.

| Tool | Việc | Ghi file | Mạng | Trả về |
|---|---|---|---|---|
| `validate_script` | Kiểm tra `script.json` theo schema v2 | không | không | `ok`; lỗi kèm đường dẫn (`chapters.1.scenes.3.voice`…); tóm tắt số cảnh, chương, định dạng, thời lượng ước tính |
| `check_layout` | Như `--frames`: thời gian ước tính, không TTS, chỉ dựng storyboard | có | không | Đường dẫn storyboard của từng định dạng, ảnh từng cảnh, cảnh báo |
| `build_storyboard` | Như `--storyboard`: TTS thật (có cache), trộn âm thanh, storyboard, `chapters.txt` | có | có (TTS) | Thời lượng, đường dẫn storyboard và `chapters.txt`, cảnh báo có mã |
| `list_catalog` | Style, brand kit, giọng đang dùng được, tên file SFX và nhạc trong thư viện của user | không | không | Danh sách |
| `wait_job` | Chờ tiếp một job chưa xong | không | không | Như tool đã tạo ra job |

- **Cảnh báo có mã.** Agent đọc mã để tự sửa, không phải đoán từ log:
  - `unknown-cue`: beat tham chiếu cue không có trong lời.
  - `no-sfx-match`: không có file SFX nào khớp.
  - `punch-too-long`: cảnh punch kéo dài quá mức.
  - `music-not-found`: không tìm thấy file nhạc đã chọn.
  - `sfx-library-empty`, `sound-library-empty`, `starter-sounds-failed`: thư viện âm thanh trống hoặc không tạo được âm thanh mẫu.
  - `no-narration`: chạy `--silent`, thời gian là ước tính.
  - `webgl-unavailable`: cảnh 3D trắng trong storyboard vì Chrome không có WebGL.

  Engine không tự đổi giọng clone sang giọng free: nếu chưa cấu hình giọng clone thì pipeline báo lỗi, còn `list_catalog` cho biết giọng nào dùng được.
- **Mỗi lần gọi tool trả lời trong vòng 45 giây.** Việc lâu hơn, ví dụ TTS cho bài dài, sẽ trả về `{ status: "running", jobId }`, rồi agent gọi `wait_job` để chờ tiếp. Lý do: Codex mặc định huỷ tool MCP sau 60 giây (`tool_timeout_sec`).
- **Annotation của MCP:**
  - `validate_script` và `list_catalog`: `readOnlyHint: true`.
  - `check_layout`: `destructiveHint: false`, `openWorldHint: false`.
  - `build_storyboard`: `destructiveHint: false`, `openWorldHint: true`.

  Codex dựa vào các annotation này để quyết định tool có cần duyệt hay không.
- **Ảnh storyboard:** tool trả về đường dẫn ảnh; agent tự mở bằng công cụ xem ảnh của nó (Claude Code dùng `Read`, Codex dùng `view_image`).
- **Render và preview không mở cho agent.** Đây là job của app, chạy khi người dùng bấm.
- **Ảnh trong kịch bản chỉ lấy từ thư mục dự án.** Khi kịch bản do agent viết (Studio tools, và render của app), ảnh (`image`, `media`, `avatar`…) phải là file trong thư mục dự án. Engine không tải link và không chép file ở nơi khác. Lý do: Studio tools được tự duyệt, nên nếu không chặn thì agent có thể chép một file bất kỳ trên máy vào dự án rồi đọc, hoặc gửi dữ liệu ra mạng qua một link ảnh, mà người dùng không được hỏi. Lexicon chỉ gọi bằng tên, và phải là file có sẵn trong thư mục lexicon đi kèm engine (không phải symlink từ đó trỏ đi nơi khác). Lệnh `npm run lesson` trong terminal vẫn nhận link và đường dẫn như trước.
  - Agent có thể đổi file hay thư mục thành symlink trong lúc engine chạy, nên engine kiểm tra ảnh sau khi mở: phải là file thường, và đường dẫn lúc đó vẫn dẫn tới đúng file đã mở trong dự án. Ảnh được ghi qua một file mới tên ngẫu nhiên, kiểm tra vị trí xong mới ghi nội dung rồi đổi tên, nên thư mục output bị đổi giữa chừng cũng không đưa ảnh ra ngoài dự án. File mới phải chỉ có một tên: một hard link trong dự án trỏ tới file tạo ở nơi khác (qua thư mục bị đổi đúng lúc tạo) không qua được bước kiểm tra. Thư mục bị đổi sau bước kiểm tra thì lệnh đổi tên không tìm thấy file mới ở nơi symlink trỏ tới, nên thất bại chứ không thay file nào.
  - Trước mỗi bước ghi (lời thoại, âm thanh, composition, storyboard, render), engine kiểm tra lại thư mục sắp ghi. Còn một khe nhỏ: file engine tự đặt tên (`index.html`, `audio.mp3`, `storyboard.jpg`…) vẫn có thể bị chuyển hướng nếu thư mục bị đổi đúng giữa lúc kiểm tra và lúc ghi. Node không có lệnh mở file theo một thư mục đã mở (như `openat`) để chặn hẳn.
  - Ảnh nằm ngoài dự án thì engine và app không tra cứu, kể cả để xem storyboard hay video có cũ không: kịch bản của agent không dùng được ảnh đó, còn một đường dẫn mạng (`\\host\share` trên Windows) có thể làm máy kết nối tới máy khác và gửi thông tin đăng nhập của người dùng.
  - App cũng đọc và ghi file của chính nó trong dự án theo cách đó: `project.json`, nhật ký `.getframes/activity.json`, `AGENTS.md` và `CLAUDE.md`. Agent để lại symlink ở chỗ các file này (hay ở tên file tạm cũ `project.json.tmp`) thì app thay symlink đó chứ không ghi xuyên qua, và không đọc file ở nơi khác rồi ghi lại vào dự án. `.agents` hay `.claude` là symlink trỏ ra ngoài thì app không ghi skill vào đó mà báo người dùng.

---

## 6. Skill cho app

Trước giai đoạn 0 có hai bản gần giống nhau là `.claude/skills/` và `.agents/skills/`. Chúng chỉ khác tên công cụ (`Read`/`view_file`, `Bash`/`run_command`, `WebFetch`/`read_url_content`), và cả hai đều tự render. Giai đoạn 0 đã làm như sau:

- **Một nguồn duy nhất, viết trung lập** ("đọc file", "gọi tool `build_storyboard`"). Nguồn này đặt ở `.agents/skills/`, nơi Codex, Devin, Antigravity và Gemini CLI đều đọc. Lệnh `npm run skills:sync` chép sang `.claude/skills/`, và CI kiểm tra hai nơi giống nhau. Không dùng symlink vì Git trên Windows mặc định không tạo symlink.
- **Skill tự đủ:** `create-lesson-video` kèm sẵn `reference/example-lesson.json` và `reference/example-short.json` (chép từ `examples/` bằng `npm run skills:sync`), vì thư mục dự án của app không có repo.
- **Hai chế độ trong cùng một skill:**
  - *Chế độ terminal* (như hiện tại): chạy `npm run lesson:storyboard`, rồi render.
  - *Chế độ app* (khi có Studio tools): tư liệu nằm trong `sources/`; dùng tool thay cho `npm run`; không render; dừng khi storyboard hết lỗi và `youtube.md` đã viết.
- **App tự quản lý skill trong dự án.** App chép bản skill đi kèm của nó vào từng thư mục dự án, và ghi đè mỗi lần mở phiên, để skill luôn khớp phiên bản engine. Người dùng không sửa skill trong dự án.
- **`CLAUDE.md` của dự án chỉ có một dòng `@AGENTS.md`**, nên nội dung hướng dẫn chỉ viết một lần.

---

## 7. Dữ liệu trên máy người dùng

**Thư mục dự án.** Mặc định `~/Movies/Get Frames/` trên macOS và `%USERPROFILE%\Videos\Get Frames\` trên Windows; người dùng đổi được.

```
<dự án>/
├── project.json         app ghi: loại video, agent, trạng thái, id phiên agent
├── sources/             tư liệu: file người dùng chọn, nội dung URL app đã tải
├── script.json          agent viết
├── youtube.md           agent viết
├── voice/ landscape/ portrait/    engine sinh ra (như hiện tại)
├── AGENTS.md  CLAUDE.md           app sinh
└── .agents/skills/  .claude/skills/   app chép vào
```

**Dữ liệu của app.** `~/Library/Application Support/Get Frames/` trên macOS, `%APPDATA%\Get Frames\` trên Windows.

```
├── settings.json        agent mặc định, giọng mặc định, thư mục dự án
├── secrets.bin          key giọng đọc, mã hoá bằng safeStorage (Keychain / DPAPI)
├── brands/<id>/         brand kit của người dùng (brand.json và logo)
├── sounds/sfx/ sounds/music/   thư viện âm thanh; engine chọn theo tên file
├── browsers/            Chrome headless do app tải về
└── logs/
```

---

## 8. Engine: việc cần sửa để chạy trong app

| # | Hiện trạng | Vị trí | Thay đổi |
|---|---|---|---|
| E1 | Render gọi `npx hyperframes` với `shell: true`. Máy người dùng không có `npx`, và `npx` có thể tải về một phiên bản khác | `src/render/hyperframes-runner.ts:32` | Gọi CLI HyperFrames đã ghim phiên bản bằng `process.execPath` (Node của Electron, `ELECTRON_RUN_AS_NODE=1`). Đọc tiến trình từ output, huỷ được bằng `AbortSignal`. Đặt `HYPERFRAMES_NO_TELEMETRY=1` và `HYPERFRAMES_BROWSER_PATH` |
| E2 | Log chỉ là chữ in ra console | `src/utils/logger.ts`, `src/lesson/pipeline.ts:55` | Thêm `onEvent` và `signal` vào `LessonRunOptions`. Sự kiện gồm bước, tiến trình, cảnh báo có mã, file đầu ra. CLI vẫn in chữ như cũ |
| E3 | Cấu hình đọc từ `.env.local` qua `process.env` | `src/lesson/cli.ts:16`, `src/config.ts` | Cho phép truyền `Config` vào pipeline. App lấy key từ safeStorage; CLI vẫn dùng dotenv |
| E4 | Brand chỉ đọc từ `assets/brand/` trong package | `src/lesson/brand.ts:41` | Thêm `BRANDS_DIR`: tìm trong thư mục của người dùng trước, rồi đến brand đi kèm. `SFX_DIR` và `MUSIC_DIR` đã có sẵn |
| E5 | `ffmpeg` và `ffprobe` gọi theo tên trong PATH | `src/assets/audio-tools.ts`, `src/lesson/audio-mix.ts:15`, `src/lesson/storyboard.ts:194`, `src/lesson/starter-sounds.ts:108` | Thêm `FFMPEG_PATH` và `FFPROBE_PATH`. Khi chạy HyperFrames, thêm thư mục chứa FFmpeg vào đầu `PATH`, vì HyperFrames tự tìm `ffmpeg` trong PATH |
| E6 | Chrome được dò trong cache và các vị trí cài phổ biến; chưa có đường dẫn Windows | `src/lesson/storyboard.ts:43` | App đặt `HYPERFRAMES_BROWSER_PATH`, biến mà `findChrome()` đã đọc sẵn. Thêm đường dẫn Chrome trên Windows cho người dùng terminal |
| E7 | `puppeteer-core` nằm trong devDependencies nhưng storyboard import nó lúc chạy | `package.json:79`, `src/lesson/storyboard.ts:87` | Chuyển sang dependencies. Nếu không, bản đóng gói chỉ cài production deps và storyboard sẽ lỗi |
| E8 | `tsc` không chép `.js`/`.css` trong `src/lesson/runtime/` và `src/lesson/styles/` sang `dist/` | `tsconfig.json` | Thêm bước chép khi build |
| E9 | HyperFrames đang ghim `^0.4.34`; bản mới nhất là 0.8.75 | `package.json:64` | Nâng cấp ở giai đoạn 2 (đã có trong lộ trình README). Bản mới hỗ trợ encoder GPU |

---

## 9. Đóng gói và lần mở đầu

**Đóng gói.** Dùng electron-builder: DMG arm64 cho macOS (không có bản cho Mac chip Intel), NSIS (x64) cho Windows. Tự cập nhật bằng electron-updater, lấy bản mới từ GitHub Releases của repo trong giai đoạn public.

**Đi kèm trong app:**
- Engine đã build, cùng production dependencies.
- Font, brand mặc định, lexicon, âm thanh mẫu.
- Hai adapter ACP (Claude Code, Codex). Adapter Codex phụ thuộc gói `@openai/codex` (330–450 MB mỗi hệ điều hành); `desktop/package.json` thay gói này bằng một gói rỗng, vì app luôn chạy bản `codex` user đã cài.
- FFmpeg và ffprobe (chọn bản nào: xem [mục 11](#11-license-điều-khoản-và-rủi-ro)).

App không đóng gói agent, vì ba lý do:
- Codex nặng 330–450 MB mỗi bản.
- Agent cập nhật hằng tuần.
- Tài khoản agent là của người dùng.

**Màn hình Setup ở lần mở đầu (có thanh tiến trình):**

1. Tải Chrome headless (Chrome for Testing `chrome-headless-shell`, khoảng 120 MB, từ máy chủ của Google) vào `browsers/`. Dùng đúng phiên bản HyperFrames ghim.
2. Chạy thử FFmpeg đi kèm.
3. Dò agent:
   - Tìm file chạy ở các vị trí cài chuẩn và trong PATH của login shell. Trên macOS, app mở từ Finder không có PATH của terminal.
   - Trên Windows, bỏ qua shim `.cmd` của npm và tìm thẳng file `.exe`.
   - Chưa cài agent: nút mở trang hướng dẫn cài chính thức. Chưa đăng nhập: hướng dẫn chạy `claude`, `codex login` hoặc `devin auth login`.
4. Chọn giọng: giọng free (Edge TTS) là mặc định; nhập key nếu muốn giọng trả phí hoặc giọng clone.
5. Chọn thư mục dự án.

**Ký số.** macOS cần chứng thư Developer ID và notarization (Apple Developer Program); Windows cần chứng thư ký mã, ví dụ Azure Trusted Signing. Nếu không ký, Gatekeeper và SmartScreen sẽ chặn ngay khi mở, nên app miễn phí vẫn phải ký. Bản MVP chạy trên máy Dan Tech thì chưa cần ký.

**Quy tắc để chạy được cả macOS và Windows:**

- Không `shell: true`, không `npx`, không dùng lệnh chỉ có trên Unix. Dùng `path.join` và `os.homedir()`.
- Mọi file chạy ngoài (ffmpeg, ffprobe, Chrome, CLI HyperFrames, agent) đều đi qua một module tìm đường dẫn, có nhánh riêng cho từng hệ điều hành.
- Ma trận CI thêm `macos-latest` và `windows-latest` ngay từ giai đoạn 0, chạy typecheck, test và `lesson:frames` với một bài mẫu. Từ giai đoạn 1, mỗi PR build thử cả app cho Windows.
- Các điểm riêng của Windows đã biết:
  - Sandbox Windows của Codex còn nhiều lỗi đang mở.
  - Sandbox của Devin CLI cần WSL 2.
  - HyperFrames 0.4.34 không dò Chrome hệ thống trên Windows. App tự tải Chrome nên không bị ảnh hưởng.

---

## 10. Cấu trúc repo

```
md-to-video-hyperframes/
├── src/                     engine, giữ nguyên vị trí
│   └── studio/              MỚI: API cho app (sự kiện, Studio tools, job runner, engine host)
├── desktop/                 MỚI: app Electron (npm package riêng, lockfile riêng)
│   ├── src/main/            project manager, Agent Hub (ACP), settings, setup
│   ├── src/engine/          engine host (utility process)
│   ├── src/preload/
│   ├── src/renderer/        giao diện (React + Vite)
│   └── electron-builder.yml
├── .agents/skills/          skill trung lập, nguồn chuẩn
├── .claude/skills/          bản chép cho Claude Code (npm run skills:sync)
└── assets/ examples/ scripts/ tests/ docs/   như hiện tại
```

- Engine giữ ở gốc repo để không làm hỏng `npm run lesson`, README, CI và các skill đang dùng.
- Khi build app, engine được build (`tsc` rồi chép runtime), sau đó `npm run stage-engine` đưa nó vào `resources/engine/` cùng production dependencies cài từ lockfile gốc. Engine host chạy từ đó; ở chế độ dev thì chạy thẳng từ repo.
- `desktop/` là npm package riêng chứ không phải workspace: `npm ci` ở gốc (mọi job CI của engine) không tải Electron, và bộ dependency của engine được đóng gói nguyên như khi test.
- App type-check theo `dist/studio/engine.d.ts`, tức đúng bản engine mà nó nạp lúc chạy.

---

## 11. License, điều khoản và rủi ro

Đây là tổng hợp nghiên cứu, không phải tư vấn pháp lý. Trước khi phát hành cho người khác nên nhờ luật sư xem lại. Get Frames miễn phí, nhưng điều đó không làm mất các nghĩa vụ dưới đây: chính sách của Anthropic, license của FFmpeg, AGPL và điều khoản của GSAP đều áp dụng cho cả phần mềm miễn phí.

| Thành phần | Tình trạng | Việc cần làm |
|---|---|---|
| Giọng free: `edge-tts-universal` | License AGPL-3.0, chạy chung tiến trình với engine (`src/tts/edge-tts-client.ts:1`). Gọi endpoint Read Aloud không chính thức của Microsoft: giả làm Edge, tự sinh token `Sec-MS-GEC`. Trên Microsoft Q&A, người kiểm duyệt trả lời rằng dùng thương mại mà không có Azure "could be a violation of our terms of service". Endpoint từng bị chặn 403 hàng loạt (10/2024) | **Giữ, theo quyết định ở mục 1.** Giai đoạn public: bản app phát hành phải tuân thủ AGPL, tức là công khai toàn bộ mã nguồn đúng phiên bản phát hành và ghi rõ trong mục About (repo đã public nên đáp ứng được). Trước khi đóng nguồn: thay bằng một client license MIT (ví dụ `msedge-tts`) hoặc tự viết. Rủi ro từ phía endpoint vẫn còn, nên trong app ghi nhãn giọng này là "miễn phí, không chính thức, có thể ngừng hoạt động" và giữ các giọng nhập key làm phương án chắc chắn |
| Claude Code | Tài liệu Agent SDK: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products"* | MVP do Dan Tech tự dùng thì rủi ro thấp. Trước khi phát hành cho người khác: xin Anthropic duyệt; nếu không được thì bản phát hành chỉ nhận API key cho Claude. Chính sách không phân biệt sản phẩm có thu tiền hay không |
| Codex | License Apache-2.0. Trang giá liệt kê `codex exec` và Codex SDK trong các gói Plus/Pro/Business. Chưa tìm thấy điều khoản nào cấm app bên thứ ba | Nhờ luật sư xem Terms of Use trước khi phát hành |
| Devin | Điều khoản cấm chia sẻ tài khoản và cấm bán lại dịch vụ | Mỗi người dùng dùng tài khoản của chính họ. Không chia sẻ hay bán lại quota |
| Antigravity | Google cấm công cụ bên thứ ba truy cập bằng tài khoản Antigravity | Hoãn. Nếu làm thì chỉ hỗ trợ Gemini API key |
| FFmpeg | Bản `ffmpeg-static` cho Mac chip M được build với `--enable-nonfree` nên không được phân phối lại. Các bản GPL (có x264) phân phối được nếu kèm mã nguồn | Không dùng `ffmpeg-static`. Giai đoạn public: bản GPL kèm mã nguồn (hoặc lời mời cung cấp mã nguồn) là đủ, vì FFmpeg chạy tiến trình riêng. Khi đóng nguồn: dùng bản LGPL và encoder của hệ điều hành (VideoToolbox, Media Foundation), để phần bản quyền sáng chế H.264/AAC thuộc về Apple/Microsoft (điểm này cần luật sư xác nhận) |
| HyperFrames | Apache-2.0. Telemetry bật mặc định, gửi dữ liệu về PostHog | Tắt telemetry, kèm license |
| Chrome headless | Google chưa cấp quyền phân phối lại | Tải về máy người dùng ở lần mở đầu, không đóng gói vào app |
| GSAP | Miễn phí, kể cả dùng thương mại. Cấm dùng trong công cụ dựng animation trực quan không cần code mà cạnh tranh với Webflow | Không làm trình sửa timeline/keyframe tự do. Xin GSAP xác nhận bằng văn bản trước khi phát hành. Ghim phiên bản |
| Simple Icons | 223 icon có license riêng, trong đó có loại cấm dùng thương mại. Logo là thương hiệu của chủ sở hữu | Allowlist icon, kèm ghi chú về thương hiệu |
| Shiki | Vài grammar dùng license GPL hoặc MPL | Giới hạn danh sách ngôn ngữ, hoặc kèm file NOTICE |
| Electron | MIT. Bản mặc định có codec H.264/AAC để phát video trong app | Kèm `LICENSES.chromium.html`. Xem lại bản quyền codec trước khi phát hành |
| `scripts/download-sfx.ts` | Lấy âm thanh từ myinstants.com, không rõ bản quyền | Chỉ là công cụ cho dev, không đưa vào app |
| three.js, Lucide, Zod, các font OFL | MIT, ISC, OFL | Kèm thông báo license |

**Trước khi đóng nguồn:**

1. Thay `edge-tts-universal` (AGPL-3.0).
2. Nhớ rằng các phiên bản đã public theo MIT vẫn là MIT: ai cũng có quyền fork bản public cuối cùng. Đóng nguồn chỉ áp dụng cho code viết sau đó.
3. Giữ thông báo bản quyền MIT của các dự án gốc (auto-video-gen, Auto-Create-Video) trong sản phẩm.

---

## 12. Lộ trình

### Giai đoạn 0: engine sẵn sàng cho app (chưa có giao diện)

| # | Việc | Trạng thái |
|---|---|---|
| 0.1 | API engine: `onEvent`, `signal`, truyền `Config`, cảnh báo có mã (E2, E3). CLI giữ nguyên | Xong |
| 0.2 | Module tìm file chạy (ffmpeg, ffprobe, Chrome, CLI HyperFrames). Bỏ `npx` và `shell: true`, tắt telemetry, huỷ render được (E1, E5, E6) | Xong. HyperFrames 0.4.34 còn tự cài bản mới chạy nền nếu không tắt: app đặt thêm `HYPERFRAMES_NO_UPDATE_CHECK` và `HYPERFRAMES_NO_AUTO_INSTALL` |
| 0.3 | `BRANDS_DIR`; chuyển `puppeteer-core` sang dependencies; build chép runtime và styles (E4, E7, E8) | Xong. `node dist/lesson/cli.js` chạy được bằng Node thường |
| 0.4 | Studio tools trong `src/studio/`: MCP server (stdio và HTTP), 5 tool ở mục 5, có test | Xong. Đã thử bằng MCP client thật, kể cả `build_storyboard` với Edge TTS |
| 0.5 | Skill trung lập kèm "Chế độ app"; `npm run skills:sync` và bước kiểm tra trong CI | Xong |
| 0.6 | CI chạy trên cả macOS và Windows | Xong. Lần chạy đầu tìm ra 2 lỗi test chỉ xuất hiện trên macOS (máy chậm hơn) và Windows (đường dẫn `D:\D:\…`), đã sửa |
| 0.7 | Kiểm chứng trong terminal: Claude Code (`--mcp-config`) và Codex (`-c mcp_servers…`) chỉ dùng Studio tools, tạo trọn một bài | Có [hướng dẫn](studio-tools.md) và test tự động qua stdio; lần chạy với agent thật làm trên máy Mac |

**Xong khi:** hai agent tạo được một bài từ chủ đề đến storyboard hết lỗi mà không chạy `npm run`, và CI xanh trên macOS và Windows.

### Giai đoạn 1: MVP trên macOS cho Dan Tech

| # | Việc | Trạng thái |
|---|---|---|
| 1.1 | Khung `desktop/`: Electron, React + Vite, electron-builder; engine host chạy trong utilityProcess | Xong: Electron 44, electron-vite 5, React 19. Engine host nạp engine đã build, chạy Studio tools qua HTTP và render |
| 1.2 | Setup lần đầu: tải Chrome headless, kiểm tra FFmpeg, dò Claude Code | Xong: đã tải thật Chrome 131.0.6778.85 qua màn hình Setup. FFmpeg dùng bản cài trên máy (xem ghi chú). Claude Code: phiên bản và tài khoản (`claude auth status --json`) |
| 1.3 | Agent Hub: ACP client, driver Claude Code, chính sách quyền, lưu phiên | Xong, có test với một agent ACP giả: tin nhắn, tool call, plan, quyền tự duyệt và quyền hỏi người dùng, huỷ, mở lại phiên, lỗi chưa đăng nhập |
| 1.4 | Các màn hình: danh sách dự án, tạo video, theo dõi agent, duyệt storyboard có ghi chú theo cảnh, hàng đợi render, kết quả, cài đặt (key giọng đọc) | Xong: đã chạy thử trong app thật, gồm gửi ghi chú storyboard và render một Short từ tab Render |
| 1.5 | Đọc URL bằng Chromium của Electron kèm Readability, lưu vào `sources/` | Xong: có cả nội dung do JavaScript thêm vào và code block giữ ngôn ngữ; PDF và text lưu nguyên |
| 1.6 | Bản build macOS chạy trên máy Dan Tech (chưa ký). CI build thử bản Windows | Có `npm run dist:mac` và `dist:win`. CI build cả hai rồi chạy `--smoke-test` trên bản đóng gói: xanh trên macOS và Windows. Còn chờ Dan chạy bản DMG trên Mac |

**Xong khi:** Dan Tech làm trọn một bài giảng (16:9 kèm Shorts) chỉ bằng app, không mở terminal.

**Ghi chú khi làm giai đoạn 1:**

- **Bài giảng kèm Short là hai kịch bản:** `script.json` (16:9) và `short/script.json` (9:16), mỗi cái có bộ file đăng bài riêng (`youtube.md`, `short/youtube.md`). Mỗi mục là một heading `##` cố định, để app tách ra thành từng nút copy.
- **Adapter Claude Code:**
  - App chạy adapter bằng Node của Electron (`ELECTRON_RUN_AS_NODE`). Một launcher nhỏ xoá biến này trước khi nạp adapter, để lệnh shell của agent không thừa hưởng nó.
  - `CLAUDE_CODE_EXECUTABLE` trỏ tới `claude` user đã cài. Bản Claude Code đi kèm Agent SDK (khoảng 220 MB) không đưa vào app.
- **Lưu phiên:**
  - App dùng `session/resume`, không phát lại lịch sử. Nếu agent chỉ có `session/load` thì app bỏ phần phát lại.
  - Nhật ký hiển thị nằm ở `.getframes/activity.json` trong thư mục dự án.
  - Phiên cũ không mở lại được thì app mở phiên mới và dặn agent đọc lại các file đã có.
- **Quyền:**
  - Khi tự duyệt, app chọn "allow once", nên không ghi rule nào vào settings của Claude Code.
  - Khi hỏi người dùng, app chỉ đưa lựa chọn cho lần này. Lựa chọn "luôn cho phép" của Claude Code sẽ ghi rule vào `.claude/settings.local.json` của dự án, hoặc chuyển agent sang chế độ không hỏi nữa (auto, bypass), nên app bỏ nó đi.
  - Phiên của app không dùng chế độ "bypass permissions", kể cả khi settings của user đặt nó làm mặc định.
  - App không mở agent trong dự án có `.claude/settings.json`, `.claude/settings.local.json` hoặc `.mcp.json`. Claude Code đọc các file này khi khởi động, nên hook và MCP server trong đó chạy trước khi app thấy yêu cầu nào; rule trong đó thì tự cho phép công cụ. App không tạo các file này, agent chỉ ghi được khi người dùng đồng ý, nên chúng thường đến từ thư mục dự án chép từ nơi khác. App báo tên file để người dùng xoá.
  - Tool của MCP server khác (không phải Studio tools) luôn hỏi người dùng.
- **Đổi thư mục dự án:** app không cho đổi khi agent hoặc render đang làm việc. Sau khi đổi, các phiên của thư mục cũ dừng lại; nhật ký của chúng vẫn nằm trong thư mục cũ.
- **Một job nặng mỗi lúc:** render và storyboard của app, storyboard của agent dùng chung một `Gate` trong engine host. Job đang chờ được huỷ mà không chen hàng.
- **`HYPERFRAMES_NODE`:** utility process chạy bằng file helper của Electron, nên engine nhận đường dẫn file chạy chính để chạy CLI HyperFrames.
- **Link tư liệu:**
  - App tải trang trong session riêng trong bộ nhớ: không cookie của user, không cấp quyền, không cho tải file. Cookie và dữ liệu của mỗi lần tải bị xoá khi tải xong, kể cả khi link là file PDF.
  - Mọi kết nối của lần tải đi qua một proxy nhỏ trong app. Proxy tự tra DNS và chỉ kết nối tới đúng địa chỉ nó đã kiểm tra, nên một tên miền trả địa chỉ công khai lúc kiểm tra rồi trả 127.0.0.1 lúc Chromium kết nối (DNS rebinding) cũng không vào được máy hay mạng nội bộ. Nếu mạng bắt buộc dùng proxy riêng (proxy công ty) thì app giữ proxy đó, vì khi ấy chính proxy công ty tra DNS.
  - File Markdown lưu ra có dòng đầu ghi rõ đây là tư liệu, không phải chỉ dẫn. Việc này giảm rủi ro trang web chèn lệnh cho agent.
- **Không kết nối ra ngoài khi mở app:** app tắt kiểm tra chính tả, vì Chromium sẽ tải từ điển từ Google trên Windows và Linux.
- **Key giọng đọc:** app không lưu key khi hệ điều hành không có kho khoá (safeStorage không dùng được).
- **FFmpeg:** MVP dùng bản cài trên máy (Homebrew, winget), có nút chọn file. Việc đóng gói FFmpeg vào app (mục 9) làm cùng lúc chọn bản LGPL (mục 11).

### Giai đoạn 2: mở rộng

| # | Việc | Trạng thái |
|---|---|---|
| 2.1 | Driver Codex (`codex-acp`) và Devin (`devin acp`) | Xong trong code, có test. Codex 0.156.1 đã chạy thật qua Agent Hub với một model giả; Devin 3000.11.3 đã mở phiên thật, chưa chạy được một lượt vì cần tài khoản |
| 2.2 | Video tin tức trong app | Xong trong code, có test: loại video "Bản tin 9:16" làm bằng engine bài giảng với template `news.*`. Đã chạy qua Studio tools với một dự án bản tin có ảnh trong `sources/` |
| 2.3 | Sửa kịch bản bằng form sinh từ schema Zod: sửa nhỏ không cần gọi agent, storyboard dựng lại ngay | Xong trong code, có test. Đã chạy thật: sửa tiêu đề một cảnh, lưu, storyboard dựng lại có lời thoại |
| 2.4 | Quản lý brand kit và thư viện SFX, nhạc | Chưa làm |
| 2.5 | Nâng HyperFrames từ 0.4 lên 0.8 | Chưa làm |
| 2.6 | Bản Windows dùng được thật, không chỉ build được | Chưa làm |

**Ghi chú khi làm giai đoạn 2:**

- **Chọn agent:** mỗi dự án ghi agent của nó trong `project.json`. Màn hình tạo video mặc định dùng agent đặt trong Cài đặt nếu đã cài, không thì agent đầu tiên đã cài. Setup và Cài đặt hiện cả ba agent: phiên bản, đăng nhập, nút đặt làm mặc định.
- **Chế độ quyền, cả ba agent:** ở giai đoạn 1 app chỉ chặn chế độ bypass của Claude Code. Nếu settings của user đặt `defaultMode` là `auto` hay `acceptEdits`, Claude Code tự quyết thay app, kể cả việc sửa settings của chính nó trong dự án. Giờ app giữ phiên ở chế độ trong bảng 4.2: lúc mở phiên, lúc mở lại phiên, và khi agent tự chuyển chế độ giữa chừng.
- **Codex:**
  - Adapter `codex-acp` 1.13.1. Gói `@openai/codex` mà nó phụ thuộc được thay bằng `desktop/stubs/openai-codex` (qua `overrides` trong `package.json`), vì app luôn đặt `CODEX_PATH`. Nhờ vậy `npm ci` và bản đóng gói không nặng thêm vài trăm MB.
  - Biến môi trường app đặt cho adapter:
    - `INITIAL_AGENT_MODE=read-only`.
    - `DISABLE_MCP_CONFIG_FILTERING=true`: không có biến này, adapter bỏ server của app khi cấu hình của user có server cùng tên.
    - `NO_BROWSER=1`: đăng nhập làm trong terminal.
    - `APP_SERVER_LOGS`: log của adapter vào thư mục log của app.
  - Adapter đánh dấu thư mục dự án là "trusted", nên Codex đọc `.codex/config.toml` của dự án (MCP server, sandbox, lệnh `notify`, hook). Vì vậy app không mở Codex trong dự án có `.codex/`.
  - Trên Windows, `npm install -g @openai/codex` chỉ để lại shim `codex.cmd`. App tìm thẳng `codex.exe` trong gói `@openai/codex-win32-x64` (hoặc `-arm64`).
  - Đã chạy thật Codex 0.156.1 qua Agent Hub, với một Responses API giả thay model:
    - Lời gọi Studio tool được app tự duyệt.
    - Sửa file ngoài dự án và lệnh xin chạy ngoài sandbox đều đến người dùng, chỉ với lựa chọn cho lần này; lệnh kèm lý do Codex đưa ra.
    - Codex coi "Cancel" là dừng cả lượt, để người dùng nói cách làm khác.
- **Devin:**
  - Chế độ qua ACP: `accept-edits` (mặc định, tự duyệt sửa file trong workspace), `smart` (model tự duyệt việc nó cho là an toàn), `ask`, `plan`, `bypass`. App chỉ cho `accept-edits`, `ask`, `plan`.
  - Devin đọc cả cấu hình của agent khác trong dự án: MCP server từ `.mcp.json`, `.claude/settings*.json`, `.cursor/mcp.json`; hook từ `.windsurf/hooks.json`. App không mở Devin khi dự án có các file này, hay có `.devin/`, `.windsurf/`.
  - Chưa đăng nhập thì `session/new` vẫn chạy; lỗi -32000 đến ở tin nhắn đầu tiên, và app báo chạy `devin auth login`.
  - Log INFO của Devin (vài chục dòng mỗi lần mở phiên) không ghi vào `agent.log` của app (`RUST_LOG=warn`); Devin vẫn giữ log riêng.
  - Chưa chạy được một lượt thật vì cần tài khoản Devin. Dạng lời gọi Studio tool lấy từ file chạy của Devin; nếu thực tế khác, app hỏi người dùng thay vì tự duyệt. Như vậy vẫn an toàn, chỉ phiền hơn. Cần kiểm tra lại khi có tài khoản.
- **Bản tin (2.2):**
  - Làm trên engine bài giảng với bộ template `news.*`, không dùng pipeline tin tức cũ (pipeline đó vẫn giữ cho terminal). Nhờ vậy bản tin có sẵn Studio tools, storyboard, hàng đợi render và bộ file đăng bài như Short.
  - Loại video "Bản tin 9:16": một kịch bản dọc, 45–90 giây. Skill có mục "News" (thứ tự cảnh, `dantech-punch`, không intro, không outro) và bài mẫu `reference/example-news.json`, có test kiểm mọi bài mẫu hợp lệ.
  - Tư liệu là bắt buộc với bản tin, cả trên màn hình lẫn khi tạo dự án, và phải có chữ: link, tài liệu hoặc nội dung dán vào. Chỉ có ảnh thì không đủ, vì agent không có dữ kiện để viết. Agent chỉ dùng thông tin trong tư liệu, và mỗi con số, câu trích dẫn đều ghi nguồn.
  - Tư liệu nhận thêm ảnh (`.jpg`, `.png`, `.webp`), dùng cho `image`, `media`, `avatar`.
  - Trong lúc làm, phát hiện engine chép mọi đường dẫn ảnh và tải mọi link ảnh trong kịch bản; đã vá cho kịch bản do agent viết (xem mục 5, "Ảnh trong kịch bản chỉ lấy từ thư mục dự án").
  - Chưa làm: tự lưu ảnh đầu bài (og:image) khi tải link bài báo.
- **Sửa kịch bản bằng form (2.3):**
  - Tab Storyboard có nút "Sửa" trên từng cảnh, thẻ chương và outro. Form sinh từ JSON Schema mà engine lấy từ schema Zod (`z.toJSONSchema`), không viết tay cho từng loại cảnh:
    - ô chữ có bộ đếm ký tự theo giới hạn của schema;
    - danh sách thêm, xoá, đổi thứ tự được, trong giới hạn số mục; danh sách không bắt buộc (ví dụ `ticker` của bản tin) bỏ được hẳn;
    - trường có nhiều dạng (ví dụ ô bảng so sánh là chữ hoặc có/không) có công tắc chọn dạng;
    - lời thoại lên đầu; nhịp hiệu ứng, chuyển cảnh, âm thanh, nhân vật gấp lại trong "Nâng cao".
  - `id` và `type` của cảnh không có trong form: đổi chúng là đổi cấu trúc, vẫn nhờ agent. Thêm, xoá cảnh cũng vậy.
  - Engine kiểm tra cả kịch bản trước khi ghi, và lỗi hiện dưới đúng ô. Kịch bản đã đổi sau khi mở form (do agent hay trình soạn thảo khác) thì không bị ghi đè: engine so phiên bản lúc bắt đầu lưu, và so lại ngay trước khi thay file. Trình soạn thảo khác không dùng chung khoá nào với app, nên vẫn còn một khe rất nhỏ giữa lần so cuối và lúc thay file.
  - `script.json` được đọc từ chính file đã mở và ghi qua một file mới, đều kiểm tra nằm trong dự án (như ảnh, mục 5): agent đổi kịch bản hay thư mục của nó thành symlink giữa chừng cũng không làm app đọc hay ghi file ở nơi khác.
  - Chỉ phần văn bản của trường đã sửa thay đổi, phần còn lại của file giữ nguyên từng byte (cách agent xuống dòng, mảng viết trên một dòng).
  - Lưu xong, app dựng lại storyboard có lời thoại, như `build_storyboard`. Lời thoại cache theo câu, nên chỉ câu đã sửa phải đọc lại. Lần sửa mới huỷ bản dựng cũ của cùng video, sau khi engine host đã nhận bản cũ (huỷ trước đó thì bản cũ vẫn chạy); bản dựng lỗi (ví dụ không vào được Edge TTS), hay bị bấm Dừng khi storyboard còn thiếu hoặc đã cũ, có nút dựng lại.
  - Storyboard ghi lại nó được dựng từ nội dung kịch bản nào (`storyboard.inputs.json`: dấu vân tay của kịch bản, và từng ảnh nó đã đọc kèm thời điểm file ảnh đổi lần cuối lúc đọc). Kịch bản bị sửa trong lúc dựng (agent sửa ngay sau khi người dùng lưu) thì storyboard vẫn bị coi là cũ, dù nó được ghi sau kịch bản. Video render cũng ghi như vậy (`video.inputs.json`), và danh sách dự án đọc bản ghi đó để biết video có cũ không. Mỗi ảnh được so riêng với chính nó: ảnh bị thay trong lúc đọc lời thoại (trước khi được chép) không làm output vừa dựng bị coi là cũ, còn ảnh bị thay sau khi đọc thì luôn làm output cũ, dù ảnh khác có thời điểm mới hơn. Storyboard và video của engine cũ, chưa có bản ghi, vẫn so theo thời gian như trước.
  - Danh sách cảnh trong tab lấy theo kịch bản hiện tại: cảnh agent thêm sau lần dựng vẫn có nút "Sửa" (chưa có ảnh), cảnh đã xoá không còn hiện. Khi storyboard đã cũ, cảnh không có id (key theo vị trí, như `s3`) và thẻ chương không gắn ảnh cũ nữa, vì vị trí đó có thể đã thuộc về phần khác.
  - Đổi video hay định dạng trong tab thì danh sách cũ không còn hiện trong lúc tải danh sách mới, nên nút "Sửa" không mở nhầm cảnh cùng key của video kia.
  - Không lưu được khi agent đang làm việc, và tin nhắn gửi trong lúc app đang lưu thì chờ lưu xong mới đi: lượt của agent và lần lưu không bao giờ chồng nhau.
  - `project.json` ghi lại phần đã sửa, và tin nhắn sau gửi agent bắt đầu bằng danh sách đó để agent đọc lại file trước khi sửa tiếp. Tin nhắn đó lỗi (mất kết nối, agent báo lỗi) thì danh sách được giữ lại cho tin nhắn kế tiếp. Skill (app mode) cũng dặn điều này.
  - Làm kèm:
    - Các lần ghi `project.json` của một dự án giờ chạy lần lượt và qua file tạm. Trước đây hai lần ghi cùng lúc (id phiên và thay đổi khác) có thể mất một thay đổi hoặc làm hỏng file.
    - Render và storyboard của app từ chối symlink trong thư mục engine ghi ra (`voice/`, `landscape/`, `portrait/`), như Studio tools.

### Giai đoạn 3: phát hành cho người dùng khác

- Ký số và notarize bản macOS, ký bản Windows; tự cập nhật.
- Pháp lý:
  - Anthropic: xin duyệt, hoặc chỉ nhận API key cho Claude.
  - GSAP: xin xác nhận bằng văn bản.
  - Luật sư xem điều khoản của Codex và Devin.
  - FFmpeg: chuyển sang bản LGPL và encoder của hệ điều hành.
  - Allowlist cho Simple Icons và Shiki.
- Đóng nguồn khi quyết định: làm theo checklist ở mục 11.

---

## 13. Câu hỏi còn mở

Không còn câu hỏi nào chặn giai đoạn 0–2. Tên sản phẩm, giá và việc không hỗ trợ Mac chip Intel đã chốt ở mục 1.

Trước giai đoạn 3 cần chuẩn bị:

- Tài khoản Apple Developer Program để ký và notarize bản macOS.
- Chứng thư ký mã cho Windows (ví dụ Azure Trusted Signing).

---

## Nguồn

**Kết nối agent:**
- ACP: [danh sách agent](https://agentclientprotocol.com/get-started/agents) · [registry](https://agentclientprotocol.com/get-started/registry) · [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) · [codex-acp](https://github.com/agentclientprotocol/codex-acp)
- Claude Code: [headless](https://code.claude.com/docs/en/headless) · [Agent SDK và chính sách đăng nhập](https://code.claude.com/docs/en/agent-sdk/overview) · [skills](https://code.claude.com/docs/en/skills)
- Codex: [non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode) · [skills](https://learn.chatgpt.com/docs/build-skills) · [MCP](https://learn.chatgpt.com/docs/extend/mcp) · [pricing](https://learn.chatgpt.com/docs/pricing) · [auth](https://learn.chatgpt.com/docs/auth)
- Devin: [Devin CLI](https://docs.devin.ai/cli) · [lệnh](https://docs.devin.ai/cli/reference/commands) · [skills](https://docs.devin.ai/cli/extensibility/skills) · [MCP](https://docs.devin.ai/cli/extensibility/mcp/configuration) · [điều khoản](https://cognition.com/legal/platform-terms-of-service)
- Antigravity: [headless](https://antigravity.google/docs/cli/headless) · [FAQ](https://antigravity.google/docs/faq) · [skills](https://antigravity.google/docs/skills)

**License và điều khoản:**
- [HyperFrames](https://github.com/heygen-com/hyperframes) · [GSAP Standard License](https://gsap.com/standard-license) · [Simple Icons disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md)
- Edge TTS và Azure: [Microsoft Q&A về Edge TTS](https://learn.microsoft.com/en-us/answers/questions/2088770/are-opensource-edge-tts-free-for-commercial-use) · [bảng giá Azure AI Speech](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/)
- FFmpeg: [FFmpeg legal](https://ffmpeg.org/legal.html) · [GPL FAQ: mere aggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)
- Chrome: [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing)
