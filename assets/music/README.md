# Nhạc nền: chọn theo tên file

Thả file nhạc vào đây, **đặt tên theo mood, thể loại và mục đích**. Mỗi style
chọn bài theo từ khoá trong tên file.

```
assets/music/
  dantech-tech-upbeat-loop.mp3
  lofi-chill-coding.mp3
  ambient-calm-architecture.mp3
  acoustic-happy-whiteboard.mp3
  synthwave-cyber-terminal.mp3
```

| Style | Từ khoá theo thứ tự ưu tiên |
|---|---|
| `dantech` | `dantech` › `tech` › `lofi` › `chill` › `ambient` › `background` |
| `blueprint` | `blueprint` › `architecture` › `ambient` › `tech` › `calm` › `lofi` › `background` |
| `whiteboard` | `whiteboard` › `acoustic` › `ukulele` › `happy` › `lofi` › `chill` › `background` |
| `terminal` | `terminal` › `synthwave` › `cyber` › `electronic` › `tech` › `background` |

Khi nhiều bài cùng khớp, pipeline chọn cố định theo tên bài học. Mỗi bài học
giữ đúng một bản nhạc qua các lần render, còn các bài học khác nhau thì được
luân phiên.

## Pipeline tự xử lý

- **Lặp** bản nhạc cho đủ độ dài video. Nhạc dạng loop (đầu và cuối nối liền)
  nghe mượt nhất.
- **Chuẩn hoá** mỗi file về −14 LUFS rồi mới áp volume của style
  (khoảng 0.14–0.16), nên file to hay nhỏ đều không sao.
- **Duck**: tự hạ nhạc khi có lời thoại (sidechain) và trả lại khi hết lời.
- **Fade** 1.5 s ở đầu video và tối đa 3 s ở cuối.

## Chỉ định trong script

```jsonc
"music": { "track": "lofi-chill-coding", "volume": 0.12 }   // tên hoặc từ khoá
"music": { "track": "ambient", "duck": false }
"music": "none"                                             // không dùng nhạc
```

## Gợi ý chọn nhạc

- Bài giảng dài (16:9): lofi, ambient hoặc piano nhẹ, không có lời, ít tiếng trống
  gắt, tránh dải tần 1–4 kHz trùng giọng nói.
- Shorts (9:16): nhạc nhịp nhanh hơn, có điểm nhấn ở vài giây đầu.
- Chỉ dùng nhạc bạn có quyền sử dụng: YouTube Audio Library, Pixabay Music,
  Epidemic Sound, Artlist… Nhạc có Content ID có thể làm video bị claim.

`npm run audio:catalog` ghi `catalog.json` và in ra mỗi style đang chọn bài nào.
Khi thư mục còn trống, pipeline dùng bản loop tổng hợp trong `_starter/`, chỉ để
thử. Thư viện ở chỗ khác thì đặt `MUSIC_DIR=/đường/dẫn` trong `.env.local`.
