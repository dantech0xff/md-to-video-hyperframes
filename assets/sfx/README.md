# Thư viện SFX: chọn theo tên file

Thả file âm thanh vào thư mục này và **đặt tên đúng với thứ âm thanh đó là**.
Pipeline chọn SFX theo từ khoá trong tên file, không cần khai báo gì thêm.

```
assets/sfx/
  transition/whoosh-soft.mp3
  transition/swoosh-fast.mp3
  transition/glitch-digital.mp3
  transition/paper-page-flip.mp3
  ui/pop-bubble.mp3
  ui/click-soft.mp3
  ui/tap-touch.mp3
  ui/typing-keyboard-mechanical.mp3
  ui/marker-pen-scribble.mp3
  ui/ding-bell.mp3
  ui/zip-swipe.mp3
  quiz/correct-success-chime.mp3
  quiz/wrong-error-buzz.mp3
  quiz/tick-tock-clock-countdown.mp3
  brand/logo-riser-intro.mp3
  brand/impact-boom-hit.mp3
  brand/outro-success-chime.mp3
```

## Quy tắc đặt tên

- Dạng `<nhóm>/<các-từ-mô-tả>.mp3`, các từ nối bằng `-`. Tên thư mục cũng là
  từ khoá: `transition/whoosh-soft.mp3` khớp cả `transition`, `whoosh` lẫn `soft`.
- Viết thường, không dấu. Có dấu cũng được vì khi so khớp dấu được bỏ đi.
- Hỗ trợ mp3, wav, ogg, m4a, aac và flac.
- **Cắt sạch khoảng lặng ở đầu file.** Âm thanh phải bắt đầu ngay ở 0 s thì mới khớp hình.
- SFX nên ngắn (dưới 3 s). Âm tick-tock đếm ngược dài bằng thời gian đếm (mặc định 4 s).
- Không cần chỉnh âm lượng. Pipeline đưa đỉnh của mỗi file về −1 dBFS, sau đó
  áp mức volume của style, rồi chuẩn hoá cả bài về −14 LUFS.

## Cách chọn file

Mỗi sự kiện trong video có một danh sách từ khoá theo thứ tự ưu tiên, khai báo
trong `src/lesson/styles/<style>/style.json` → `sfx`. Pipeline lấy từ khoá đầu
tiên khớp được với một file:

1. trùng đúng đường dẫn (`ui/ding-bell`), rồi trùng đúng tên file (`ding-bell`);
2. tên file chứa **tất cả** các từ của từ khoá (`tick tock` khớp `tick-tock-clock.mp3`);
3. nếu không từ khoá nào khớp trọn vẹn thì lấy file khớp được nhiều từ nhất.

Khi nhiều file cùng khớp, pipeline chọn cố định theo cảnh: render lại vẫn ra
đúng file đó, còn các cảnh khác nhau thì luân phiên các file khác nhau. Muốn
có nhiều biến thể thì cứ đặt `whoosh-soft-1.mp3`, `whoosh-soft-2.mp3`…

Mỗi style có mood riêng: `terminal` ưu tiên `glitch` và `beep`, `whiteboard`
ưu tiên `paper`, `marker` và `pencil`, `blueprint` ưu tiên `soft` và `scan`.
Nếu thư viện không có những từ đó thì style dùng tiếp các từ chung phía sau.

| Sự kiện | Khi nào | dantech | blueprint | whiteboard | terminal |
|---|---|---|---|---|---|
| `transition` | chuyển cảnh | `whoosh` › `swoosh` › `swish` › `transition` | `swoosh soft` › `whoosh soft` › `scan` › `whoosh` › … | `paper` › `page flip` › `swish` › `whoosh` › … | `glitch` › `whoosh digital` › `whoosh` › … |
| `reveal` | hiện từng ý (`{1}`, `{2}`…) | `pop` › `click` › `blip` › `tick` | `tick` › `blip` › `click` › `pop` | `marker` › `pencil` › `pop` › … | `blip` › `beep` › `click` › … |
| `focus` | soi dòng code (`{L3-5}`) | `tick` › `click` › `blip` | như dantech | như dantech | `beep` › `blip` › `tick` › `click` |
| `highlight` | nhấn mạnh (`{hl:id}`) | `ding` › `chime` › `sparkle` › `pop` | `scan` › `chime` › `ding` › … | `marker` › `scribble` › `ding` › … | `beep` › `blip` › `ding` › … |
| `flow` | gói dữ liệu chạy trên sơ đồ | `zip` › `swipe` › `whoosh small` › `blip` | `scan` › `zip` › … | `marker` › `pencil` › `swish` › … | `data` › `digital` › `zip` › `blip` |
| `tap` | chạm màn hình điện thoại | `tap` › `click` › `pop` | như dantech | như dantech | như dantech |
| `type` | gõ code / terminal | `typing` › `keyboard` › `type` | như dantech | `pencil` › `writing` › `typing` › … | như dantech |
| `countdown` | đếm ngược quiz (`{pause:4}`) | `tick tock` › `clock` › `countdown` › `tick` | như dantech | như dantech | như dantech |
| `correct` | lộ đáp án (`{answer}`) | `correct` › `success` › `ding` › `chime` | như dantech | như dantech | `access granted` › `correct` › … |
| `wrong` | dùng khi gọi tên trong script | `wrong` › `error` › `buzz` › `fail` | như dantech | như dantech | `access denied` › `error` › … |
| `chapter` | thẻ mở chương | `impact` › `hit` › `boom` › `swoosh` | `hit soft` › `impact` › … | `page flip` › `paper` › … | `glitch` › `impact` › … |
| `intro` | logo mở đầu | `logo` › `intro` › `riser` › `impact` | như dantech | như dantech | `glitch` › `logo` › … |
| `outro` | màn kết | `outro` › `success` › `chime` | như dantech | như dantech | như dantech |

## Chỉ định SFX trong script

```jsonc
// thêm SFX vào cảnh, tại một cue trong lời thoại, ví dụ "…đọc từ {cache}cache…"
"sfx": [{ "at": "cache", "name": "ui/ding-bell", "volume": 0.4 }]

// đổi âm của một beat, hoặc tắt hẳn bằng false
"beats": [{ "at": "{2}", "do": "reveal", "target": 2, "sfx": "pop-bubble" }]
"beats": [{ "at": "net", "do": "focus", "lines": "8", "sfx": false }]
```

`at` nhận tên cue (có hoặc không có `{}`), `"start"`, `"end"`, hoặc số giây tính
từ lúc bắt đầu lời thoại của cảnh.

## Kiểm tra trước khi render

```bash
npm run audio:catalog                    # ghi catalog.json + in ra mỗi style sẽ chọn file nào
npm run audio:catalog -- --style terminal
```

`catalog.json` liệt kê tên, độ dài và từ khoá của mọi file. Skill
`create-lesson-video` đọc file này để chọn SFX theo mood của từng bài.

## Bộ âm thanh mẫu `_starter/`

Khi thư viện còn trống, pipeline tự tạo một bộ âm thanh tổng hợp bằng ffmpeg
vào `_starter/` (hoặc chạy `npm run sounds:starter`). Bộ này chỉ để thử, và
**file của bạn luôn được ưu tiên**: file trong `_starter/` chỉ được dùng khi
không file nào khác khớp. Thư mục này không được commit (xem `.gitignore`).

Thư viện ở chỗ khác thì đặt `SFX_DIR=/đường/dẫn` trong `.env.local`.
Chỉ dùng âm thanh bạn có quyền sử dụng: tự làm, Pixabay, YouTube Audio Library,
Epidemic, Artlist…
