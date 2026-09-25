# Scene catalog (lesson script v2)

Every scene has these common fields:

| Field | Notes |
|---|---|
| `type` | One of the types below (required). |
| `voice` | Narration with cue markers (required). See `narration.md`. |
| `id` | `a-z0-9-`, unique across the lesson. Used for output names and SFX seeds. |
| `beats` | Explicit timed actions: `{ "at": "cueName" \| "start" \| "end" \| seconds, "do": …, "target", "lines", "path", "note", "sfx" }`. |
| `transition` | Into this scene: `auto` (the style decides), `none`, `fade`, `push`, `slide-up`, `zoom`, `wipe`, `iris`, `blinds`, `blur`, `glitch`. |
| `sfx` | Extra sounds: `[{ "at": "cue", "name": "ui/ding-bell", "volume": 0.4 }]`. |
| `hold` | Seconds to stay on screen after the narration (0–8; default from the style). |
| `mascot` | `false`, a pose (`idle`, `wave`, `point`, `think`, `celebrate`), or `{ "pose", "side", "say", "talk" }`. See `look-and-sound.md`. |

Visible text fields support `*accent*`, `==highlight==`, `**bold**` and `` `code` ``.
Limits are character counts, enforced by the schema.

Cue quick reference (details in `narration.md`):

| Marker | Action |
|---|---|
| `{1}` `{2}`… | Reveal item n: list item, layer, row, callout, command, or diagram node (n-th in layout order). |
| `{L3}` `{L3-5,8}` | Focus code lines. |
| `{show:id}` | Reveal a diagram node. |
| `{hl:id}` / `{hl:2}` | Highlight a node, layer or list item. On title/statement scenes, draws the `==highlight==` sweep. |
| `{flow:a>b>c}` | Send a packet along diagram edges. |
| `{tap:n}` | Tap ripple on phone callout n. |
| `{zoom:id}` `{zoom:2}` / `{zoom:out}` | Camera push-in on a node or item, and back out. |
| `{answer}` | Reveal the quiz answer. |
| `{pause:N}` | N seconds of silence (0.2–12). |
| `{anyName}` | Named cue for `beats[].at` or `sfx[].at`. |

Use each marker name **once per scene** (a repeated name keeps only its last position).

---

## Openers and structure

### `title`: the hook / cold open
`title` ≤90 (required) · `subtitle` ≤140 · `kicker` ≤48 (default: series · Bài n · level) · `icons` ≤4 (`"si:kotlin"`, `"database"`…).
The first icon's name becomes the giant faded background word (`si:kotlin` → KOTLIN), so put the tech's logo first.
```json
{ "id": "hook", "type": "title",
  "voice": "Màn hình của bạn đang gọi API trực tiếp? Đó chính là lúc app bắt đầu khó test.",
  "title": "Đừng để *Activity* gọi API trực tiếp",
  "subtitle": "Repository Pattern trong Clean Architecture",
  "icons": ["si:kotlin", "si:android", "database"] }
```

### `statement`: one strong sentence (hook, key takeaway, warning)
`text` ≤110 (required) · `sub` ≤140 · `tag` ≤28 · `icon` · `emphasis` ≤4 phrases taken from `text` (drawn with a marker sweep).
The sweep runs after the text appears, or at `{hl:1}` if you mark the moment.
```json
{ "type": "statement", "tag": "Ghi nhớ", "icon": "lightbulb",
  "voice": "Nguyên tắc vàng: {hl:1}UI không bao giờ biết dữ liệu đến từ đâu.",
  "text": "UI không bao giờ biết dữ liệu đến từ đâu", "emphasis": ["không bao giờ"] }
```

### `objectives` / `recap`: checklists
`items` (objectives 2–5, recap 2–6; each ≤90) · `title` ≤60 (defaults "Sau bài này bạn sẽ" / "Tóm tắt bài học").
`{n}` reveals and ticks item n. Items without a cue appear in sequence at the start.
```json
{ "type": "objectives",
  "voice": "Sau bài này, bạn sẽ {1}hiểu Repository là gì, {2}biết nó nằm ở đâu, {3}và tự viết được một Repository.",
  "items": ["Hiểu Repository là gì", "Biết nó nằm ở đâu trong Clean Architecture", "Tự viết Repository có cache"] }
```

### `concept`: define a term
`term` ≤48 and `definition` ≤200 (both required) · `tag` ≤28 (e.g. "Khái niệm") · `icon` · `example` ≤140 (shown in a code-ish box).
Its bottom-right corner is usually free, which makes it a good place for a pointing mascot with a bubble.

### `bullets`: 1–6 points
`title` ≤70 (required) · `items`: strings ≤110 or `{ "text", "sub" ≤100, "icon" }` · `numbered` · `layout: "list" | "grid"` (grid = cards, good for 3–6 short items with icons).
`{n}` reveals item n. `{hl:n}` pulses it.

---

## Code

### `code`: syntax-highlighted editor (Shiki)
`lang` and `code` (≤2400 chars) are required · `title` ≤70 · `filename` ≤48 · `focus` (initial lines, e.g. "3-5") · `typing` (default: on for ≤14 lines).
- Keep it to **14 lines or fewer** and about 60 characters per line. Cut imports, logging and boilerplate. Use `// …` for omitted parts.
- `{L1-4}` dims the rest and puts a focus bar on those lines. For a note next to the focus, use a beat:
  `"beats": [{ "at": "cache", "do": "focus", "lines": "7", "note": "Cache trước: nhanh, chạy được offline" }]`, with `{cache}` in the voice.
- Language ids: kotlin (also `kt`, `kts`), java, swift, dart, ts, js, python, go, rust, sql, json, yaml, bash, xml, http, `gradle` (Groovy DSL; use kotlin for `build.gradle.kts`)…

### `diff`: before → after
`lang`, `before` (≤1400) and `after` (≤1400) are required · `title` · `filename`.
Removed lines get struck through and added lines slide in. Line numbers for `{L…}` count rows in the displayed unified diff.

### `terminal`: commands and output
`commands`: 1–5 × `{ "cmd" ≤140, "output" ≤600 }` · `title` ≤70.
`{n}` types command n. Commands without a cue type in sequence: the first at the start, the rest spread over the narration. Output appears after each command.

---

## Architecture

### `diagram`: boxes and arrows with auto-layout
- `nodes` (2–9): `{ "id", "label" ≤26, "sub" ≤30, "kind", "icon" }`. `kind` picks the icon: mobile, web, client, user, api, gateway, server, service, function, db, cache, queue, storage, cloud, auth, ai, external, module.
- `edges` (≤14): `{ "from", "to", "label" ≤22, "dashed" }`.
- `direction`: `auto` (LR in 16:9, TB in 9:16), `LR` or `TB`.
- `progressive`: reveal nodes spread over the narration.
- Other fields: `title`.

Cues:
- `{show:repo}` pops a node in. Prefer it over `{n}`, which counts nodes in layout order (rank by rank).
- `{flow:app>repo>db}` sends a glowing packet along the edges, pulsing each node it passes. Use one flow per sentence.
- `{hl:db}` pulses a node.
- `{zoom:repo}` … `{zoom:out}` pushes the camera in and back out.

Layout is layered by longest path. Keep it to 3–4 ranks and at most 3 nodes per rank. Keep labels short; put detail in `sub`.
```json
{ "type": "diagram", "title": "Dữ liệu đi qua Repository",
  "voice": "Khi cần dữ liệu, {flow:app>repo>db}ViewModel hỏi Repository, Repository đọc cache trước. {flow:repo>api>server}Sau đó mới gọi API.",
  "nodes": [
    { "id": "app", "label": "App Android", "sub": "ViewModel", "kind": "mobile" },
    { "id": "repo", "label": "Repository", "sub": "UserRepositoryImpl", "kind": "module" },
    { "id": "db", "label": "Room", "sub": "cache SQLite", "kind": "db" },
    { "id": "api", "label": "REST API", "sub": "Retrofit", "kind": "api" },
    { "id": "server", "label": "Backend", "sub": "Ktor + PostgreSQL", "kind": "server" } ],
  "edges": [ { "from": "app", "to": "repo" }, { "from": "repo", "to": "db", "label": "đọc cache" },
             { "from": "repo", "to": "api", "label": "HTTPS" }, { "from": "api", "to": "server" } ] }
```

### `layers`: layered architectures
- `layers` (2–5): `{ "id", "name" ≤26, "items" ≤4 × ≤26, "note" ≤50 }`.
- `mode`: `stack` (horizontal bands, default) or `onion` (concentric rings).
- `rule` ≤60: the dependency caption.
- `core` (stack): index of the layer every other layer depends on. Clean Architecture Presentation/Domain/Data ⇒ `core: 1`, so arrows point into Domain.
- Other fields: `title`.

`{n}` reveals layer n and `{hl:n}` highlights it.

---

## Mobile

### `phone`: an app screen with callouts
- Screen, one of:
  - `image`: a screenshot path relative to the script, or a URL
  - `ui`: a drawn mock: `{ "appBar" ≤28, "items" ≤6 × { "title" ≤34, "sub" ≤40, "icon" }, "button" ≤26, "toast" ≤40, "state": content | loading | error | empty }`
- `callouts` (≤4): `{ "text" ≤40, "x", "y" }`. x/y are percentages of the screen.
- `points` (≤4, each ≤70): bullets beside the phone (16:9) or below it (9:16).
- `platform`: android | ios.
- Other fields: `title`.

`{n}` reveals callout n. `{tap:n}` plays a tap ripple at callout n and flashes UI row n.

---

## Judging and checking

### `compare`: table with ✓/✗ or short values
- `columns`: 2–3 × ≤24.
- `rows` (1–6): `{ "label" ≤32, "values": [true | false | "text ≤34", …] }`, with exactly one value per column.
- `winner`: a 0-based column that gets a crown at the end.
- Other fields: `title`.

`{n}` reveals row n.

### `quiz`: retention check with a countdown
`question` ≤130 · `options` 2–4 × ≤70 · `answer` (0-based index) · `explain` ≤140.
Ask the question, then leave `{pause:3}`–`{pause:5}` (a pause of 1.5 s or more shows a countdown ring), then `{answer}` and say why:
`"voice": "Câu hỏi nhanh: interface Repository nên nằm ở lớp nào? {pause:4} {answer}Đáp án là Domain. Lớp Data chỉ hiện thực nó."`
Order the options so the answer is not always the same letter.

### `image`: a screenshot or photo, full frame
`src` (required; path relative to the script, or a URL) · `title` ≤70 · `caption` ≤120 · `fit`: cover | contain · `motion`: zoom-in | zoom-out | pan-left | pan-right | none (Ken Burns).

---

## Automatic scenes
- **Intro sting** (logo): `"intro": "auto"` puts it after the first scene in 16:9 and leaves it out in 9:16. Other values: `start`, `after-first`, `none`.
- **Chapter cards**: shown when the lesson has more than one chapter. `chapter.voice` is read over the card, e.g. "Phần hai. Repository trong kiến trúc." Set `"card": false` on a chapter to skip it.
- **Outro**: `"outro": { "next": "Bài 8 · Use Case và DI với Hilt", "voice": "…" }`. Set `"enabled": false` to drop it.
