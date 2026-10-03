# Get Frames: checklist nghiệm thu giai đoạn 1 trên Mac

> **Ngày:** 2026-10-03
> **Mục tiêu:** kiểm tra tiêu chí "xong" của giai đoạn 1 trong [lộ trình](2026-09-25-desktop-app-architecture.md#12-lộ-trình): làm trọn một bài giảng 16:9 kèm Short chỉ bằng app, không mở terminal. Checklist này cũng gồm hai việc còn chờ máy Mac: bản DMG chạy trên Mac (1.6) và lần chạy với agent thật trong terminal (0.7).
> **Cách dùng:** làm lần lượt và đánh dấu từng ô. Ô nào không đạt thì ghi lại hiện tượng, rồi gửi kèm log ở mục cuối.

---

## 1. Chuẩn bị

Phần này được dùng terminal. Tiêu chí "không mở terminal" tính từ mục 2.

- [ ] Máy Mac chip Apple. App không có bản cho Mac chip Intel.
- [ ] Claude Code đã cài và đăng nhập: chạy `claude` một lần.
- [ ] FFmpeg đã cài: `brew install ffmpeg`.
- [ ] Có bản DMG, theo một trong hai cách:
  - Tải artifact `get-frames-macOS` ở lần chạy CI mới nhất trên `main` (trang Actions của repo; CI giữ artifact 14 ngày). Bản này chưa ký, nên sau khi cài phải gỡ cờ cách ly: `xattr -dr com.apple.quarantine "/Applications/Get Frames.app"`.
  - Hoặc build trên máy theo [desktop/README.md](../../desktop/README.md#build-và-cài-trên-mac).
- [ ] Kéo Get Frames vào Applications.
- [ ] Có tư liệu cho một bài thật: một file `.md` (dàn ý, ghi chú) và một hai link bài viết.

## 2. Lần mở đầu

- [ ] Mở app từ Finder, không mở từ terminal. App mở từ Finder không có PATH của terminal, và đây là điều cần thử.
- [ ] Chrome headless tải xong (khoảng 100 MB), có thanh tiến trình.
- [ ] App tự tìm thấy FFmpeg cài bằng Homebrew.
- [ ] Phần AI agent hiện Claude Code với phiên bản và trạng thái đăng nhập. Đặt Claude Code làm mặc định.
- [ ] Giọng đọc: để giọng miễn phí (Edge TTS).
- [ ] Thư mục dự án: mặc định là `~/Movies/Get Frames`.

## 3. Tạo video

- [ ] **Tạo video mới**, loại "Bài giảng 16:9 kèm Short".
- [ ] Nhập chủ đề thật. Tư liệu gồm file `.md` và các link.
- [ ] Brand kit, style và giọng: để mặc định hoặc chọn tuỳ ý. Agent: Claude Code.
- [ ] Sau khi tạo, thư mục `sources/` của dự án có bản Markdown của từng link. Dòng đầu mỗi file ghi rõ đây là tư liệu.

## 4. Agent viết kịch bản (tab Agent)

- [ ] Tab Agent hiện từng bước: tin nhắn, lời gọi tool, kế hoạch.
- [ ] Studio tools, việc đọc và sửa file trong dự án được tự cho phép. Lệnh shell và truy cập mạng thì app hỏi, và chỉ có lựa chọn cho lần này.
- [ ] Agent dừng khi storyboard của cả hai video hết lỗi.
- [ ] Thư mục dự án có `script.json`, `short/script.json`, `youtube.md` và `short/youtube.md`.
- [ ] (Tuỳ chọn) Dừng agent giữa chừng một lần, rồi gửi tin nhắn mới: agent làm tiếp được.

## 5. Duyệt và sửa storyboard (tab Storyboard)

Làm với cả video 16:9 lẫn Short.

- [ ] Ảnh, lời thoại và thời gian của từng cảnh khớp nhau. Bấm vào ảnh thì ảnh phóng to.
- [ ] Viết ghi chú cho hai ba cảnh và một ghi chú chung, rồi bấm **Gửi ghi chú cho agent**. Agent sửa đúng các cảnh đó, và storyboard được dựng lại.
- [ ] Bấm **Sửa** trên một cảnh, đổi tiêu đề rồi lưu: storyboard dựng lại với nội dung mới.
- [ ] Bấm vào lời thoại của một cảnh để sửa ngay trên dòng. Giữ nguyên một cue như `{1}`, rồi lưu. Thử thêm Esc để bỏ một lần sửa.
- [ ] Thêm một cảnh, nhân bản một cảnh, chuyển một cảnh lên rồi xuống, xoá một cảnh. Sau mỗi lần, storyboard dựng lại đúng thứ tự.
- [ ] Viết ghi chú cho một thẻ chương, rồi đổi chỗ chương đó với chương bên cạnh. Ghi chú vẫn đi theo đúng chương đó, không ở lại vị trí cũ.
- [ ] Xoá outro: dòng outro còn lại với nhãn "tắt" và không còn nút xoá. Bật lại bằng **Sửa** → "Hiện outro" → "Có". Đổi chỗ phát intro trong **Sửa** của dòng intro.
- [ ] Sau khi sửa trong app, gửi agent một tin nhắn. Tin nhắn đó liệt kê các phần bạn đã sửa, và agent đọc lại file trước khi sửa tiếp.
- [ ] Trong lúc agent đang làm việc, các nút sửa bị khoá.

## 6. Render (tab Render)

- [ ] Bấm **Lời thoại** của một video. Danh sách câu TTS sẽ đọc khớp với kịch bản và không còn cue. Sửa một câu ở đây được.
- [ ] Render Short ở chế độ **Xem trước**: ra video HD, xem thử được.
- [ ] Bấm **Render tất cả** ở chế độ **Chuẩn**. Máy không ngủ trong lúc render, và app báo khi xong. Ghi lại thời gian render (dự kiến khoảng 5–6 lần thời lượng video).
- [ ] Trong lúc một render đang chạy, xếp thêm một render rồi huỷ nó ở thanh bên trái. Render đó bị huỷ ngay, còn render đang chạy vẫn tiếp tục.
- [ ] Sửa một câu lời thoại sau khi render xong. Video đó hiện "(bản cũ)" và app nhắc render lại.
- [ ] (Tuỳ chọn) Render Short ở chế độ **Ultra**: ra video 2K, 60 fps.

## 7. Kết quả và đăng bài (tab Kết quả)

- [ ] Phát được video 16:9 và Short ngay trong app.
- [ ] Copy được từng phần của bộ file đăng bài:
  - video 16:9: Tiêu đề, Mô tả, Tags, Thumbnail, và chương (`chapters.txt`);
  - Short: Tiêu đề, Caption, Hashtags, Thumbnail.
- [ ] **Mở thư mục dự án** mở đúng thư mục trong Finder.
- [ ] Tải video lên YouTube ở chế độ riêng tư. Chương và phụ đề hiện đúng.

## 8. Mở lại và xoá dự án

- [ ] Thoát app rồi mở lại (tốt nhất là hôm sau). Dự án còn đủ, và phiên agent nối tiếp: agent nhớ việc đã làm.
- [ ] Xoá một dự án thử. Thư mục của nó vào Thùng rác và khôi phục được.

**Đạt hết các mục 2–8** (trừ các ô tuỳ chọn) thì giai đoạn 1 xong. Sau đó cập nhật dòng 1.6, dòng trạng thái và tiêu chí "Xong khi" của giai đoạn 1 trong tài liệu lộ trình.

---

## 9. Agent thật trong terminal (mục 0.7)

Việc này độc lập với app: agent dùng Studio tools trong terminal, không qua app. Làm theo [hướng dẫn Studio tools](studio-tools.md), mục 1 đến 4, với Claude Code (mục 3a), và với Codex (mục 3b) nếu có tài khoản.

- [ ] Gõ `/mcp` trong Claude Code thấy server `studio` đã kết nối.
- [ ] Agent tạo một bài từ chủ đề đến storyboard hết lỗi chỉ bằng Studio tools, không chạy `npm run`.
- [ ] Thư mục dự án có các file mà mục 4 của hướng dẫn liệt kê.

## Khi có lỗi: những gì cần gửi

- Log của app trong `~/Library/Application Support/Get Frames/logs/`: `main.log`, `engine.log`, `agent.log` và thư mục `agents/claude-code/`.
- Nhật ký phiên agent của dự án: `.getframes/activity.json` trong thư mục dự án.
- Ảnh chụp màn hình và các bước để làm lại lỗi.
