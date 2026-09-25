# Narration: Vietnamese tech voice, cues, pronunciation

## How to talk

- Talk to one learner: "bạn", "mình". Keep it warm and direct. No "Xin chào các bạn, hôm nay chúng ta sẽ…" preamble: the hook starts on the problem.
- Use one idea per sentence and 8–20 words. End every sentence with `.` or `?` so the voice pauses naturally.
- Explain, then name: "Lớp trung gian che giấu nguồn dữ liệu — người ta gọi nó là Repository."
- Say the *why* before the *how*. Give concrete app examples (hồ sơ người dùng, giỏ hàng, chat) over abstract ones.
- Never read code character by character. Describe intent: "hàm getUser trước hết thử lấy từ cache" rather than "dao chấm find mở ngoặc id".
- Screen and voice complement each other: the screen shows keywords and code, and the voice tells the story around them.
- Pace: about 2.6 words per second (free voice). 150 words ≈ 1 minute.

## Cue markers: syncing visuals to words

A marker goes **right before the word** that should trigger the visual. The action fires when the narrator starts that word, using real word timings from the TTS.

```
"Sau bài này, bạn sẽ {1}hiểu Repository là gì, {2}biết nó nằm ở đâu, {3}và tự viết được một Repository."
```

| Marker | Effect | Scenes |
|---|---|---|
| `{1}` `{2}`… | Reveal item n | bullets, objectives, recap, layers, compare, phone callouts, terminal commands, diagram nodes |
| `{L7}` `{L3-5,8}` | Focus code lines | code, diff |
| `{show:id}` | Reveal a node | diagram |
| `{hl:id}` `{hl:2}` | Highlight: node pulse, layer border, item pulse, `==marker==` sweep | diagram, layers, bullets, statement, title |
| `{flow:a>b>c}` | Packet travels along the edges | diagram |
| `{tap:n}` | Tap ripple at callout n | phone |
| `{zoom:id}` `{zoom:n}` · `{zoom:out}` | Camera push-in · reset | any scene with nodes or items |
| `{answer}` | Reveal the correct option + confetti | quiz |
| `{pause:N}` | N seconds of silence (0.2–12, default 1) | any; quiz countdown, "thử tự làm nhé" |
| `{myName}` | Named cue for `beats` / `sfx` (`"at": "myName"` or `"at": "{myName}"`) | any |

Rules:
- Use each marker name once per scene.
- Items without a cue appear automatically at the start. Cue every item or none, so the scene stays consistent.
- For a note next to focused code, or an action at a moment you name yourself, use `beats`:
  ```json
  "voice": "Đầu tiên {cache}thử lấy từ database. {net}Nếu chưa có thì gọi API rồi lưu lại.",
  "beats": [
    { "at": "cache", "do": "focus", "lines": "7", "note": "Cache trước: nhanh, chạy offline" },
    { "at": "net", "do": "focus", "lines": "8-9", "note": "Chưa có thì gọi API rồi lưu vào Room" }
  ]
  ```
  `do` can be `reveal`, `focus`, `show`, `highlight`, `flow` (with `path`), `tap`, `check`, `type` or `zoom`. `"sfx": "pop-bubble"` or `false` overrides a beat's sound.
- The pipeline warns `beats reference unknown cue(s)` when a beat names a cue that is not in the narration.

## Pronunciation (read by a Vietnamese TTS)

`voice` is spoken. Visible fields keep normal formatting.

**Numbers and symbols: spell them out in `voice`.**

| Written | Say |
|---|---|
| `Kotlin 2.1` | `Kotlin hai chấm một` |
| `Android 15` | `Android mười lăm` |
| `82.7%` | `tám mươi hai phẩy bảy phần trăm` |
| `200ms` | `hai trăm mili giây` |
| `10x` | `nhanh gấp mười lần` |
| `v2` | `phiên bản hai` |
| `3:1` | `ba trên một` |
| `$5` | `năm đô la` |

Avoid `→ & % $ # + = / _ ( ) { } < >`, emoji and URLs in `voice`. Say "dantech chấm academy" rather than writing a URL.

**English tech terms.**
- **Free voice (Edge)**: the `tech-vi` lexicon (`assets/lexicon/tech-vi.json`) is applied automatically. It rewrites acronyms and product names the voice would mangle, such as API → "ây pi ai", JSON → "giây sơn", SQL → "ét kiu eo", iOS → "ai ô ét", CI/CD, MVVM, gRPC, GraphQL, Node.js, Kubernetes, Jetpack Compose, SwiftUI, Git/GitHub and CDN/DNS/TCP (62 terms). Matching is case-sensitive and whole-word, so "UI" does not fire inside "UIKit". Cue markers still land correctly after the rewrite.
- A term missing from the lexicon: add it (`"Term": "cách đọc"`) when you are confident of the reading, or rephrase. List the terms you are unsure about in your report so the user can check them in a preview.
- Common words like Repository, ViewModel, Activity, Room, Retrofit, Hilt, Flow and coroutine are usually fine. Keep them in English, because that is how developers talk.
- **Clone voice**: no lexicon by default, because a cloned voice reads English terms the way the instructor does. Enable it with `"voice": { "profile": "clone", "lexicon": "tech-vi" }` if needed.

**Rhythm tricks.**
- A comma gives a short breath and a period a full stop. `{pause:0.5}` gives a deliberate beat before a reveal.
- Put the key term at the end of the sentence: "Nơi chứa interface đó chính là… Domain."
- In a quiz, ask the question, then `{pause:3}`–`{pause:5}`, then `{answer}Đáp án là …`, then one sentence on why.

## Scene-by-scene narration patterns

| Scene | Pattern |
|---|---|
| Hook (title/statement) | A pain or surprising fact, then a promise: "Màn hình gọi API trực tiếp? Đó là lúc app bắt đầu khó test." |
| objectives | "Sau bài này, bạn sẽ {1}…, {2}…, {3}…" |
| concept | Definition in plain words, one analogy, name the term. |
| layers / diagram | Walk the flow in the order the data moves; one `{flow:…}` per sentence. |
| code | The what (1 sentence), then 2–3 focused lines with `{L…}` or named beats, then the takeaway. |
| terminal | "{1}Chạy thử…", then the result. |
| phone | The user's view: "{1}hồ sơ hiện ngay từ cache, {2}{tap:2}kéo để làm mới…" |
| compare | "{1}… {2}… {3}…" one row per sentence, ending with the winner. |
| quiz | Question → `{pause:4}` → `{answer}` → why. |
| recap | Repeat the objectives as results: "Giờ bạn đã {1}…" |
| chapter voice | "Phần hai. <chapter title>." |
| outro voice | Tease the next lesson and give a short sign-off: "…Hẹn gặp lại bạn ở Dan Tech." |
