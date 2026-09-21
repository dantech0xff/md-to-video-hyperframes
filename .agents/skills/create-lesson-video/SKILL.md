---
name: create-lesson-video
description: Tạo video bài giảng ngắn 9:16 (~60s) từ bài học (.txt/.md) hoặc URL — biến tài liệu giáo dục thành video giảng dạy có khái niệm, bước làm, công thức, quiz. Trigger khi user yêu cầu tạo video bài học, video giảng dạy, làm video dạy học, lesson video, educational video, video cho học sinh. Output: video.mp4 + voice.mp3 + script.txt.
---

# Create Lesson Video Skill

Generate a Vietnamese 9:16 motion-graphic **lesson video** from teaching material (URL, `.txt`/`.md` file, or a pasted topic outline). Same render pipeline as `create-news-video` — the difference is the **pedagogical script structure** and the educator templates.

## Input

Single argument: a URL (`http://`/`https://`), a path to a `.txt`/`.md` file, or a short topic description.

## Pedagogical structure (use this arc)

A good lesson video follows this arc — pick 3–6 body scenes that fit the material:

1. **hook** — a question or surprising fact ("Cây xanh tự nấu ăn thế nào?")
2. **chapter** *(optional)* — divider when the lesson has multiple parts ("PHẦN 1 — Khái niệm")
3. **definition** — the core concept, term + plain-language definition
4. **steps** / **timeline** / **formula** — the mechanics: process, sequence, or math/code
5. **myth-fact** *(optional)* — correct a common misconception
6. **quiz** *(recommended)* — one quick check for retention; reveal lands near scene end
7. **key-point** — the one thing to remember
8. **outro** — fixed format, CTA + channel + source

Rules:
- `scenes[0].type` MUST be `hook`, last MUST be `outro` — total 5–8 scenes.
- One idea per scene. voiceText is what the learner *hears*; templateData is what they *see* — keep them aligned but not identical.
- `definition.definition` can carry a full sentence (max 160 chars) — this is the one place longer text is OK.

## Template catalog

News templates (existing):

| Template | Fields | Use for |
|---|---|---|
| `hook` | `headline` ≤40, `subhead` ≤40, `bgSrc` = `"$source.image"` optional, `kenBurns` | Opening attention grab |
| `comparison` | `left`/`right`: `{label ≤30, value ≤20, color: cyan\|purple}`, `right.winner?` | A vs B |
| `stat-hero` | `value` ≤20, `label` ≤40, `context` ≤50 | Big number/stat |
| `feature-list` | `title` ≤40, `bullets` 1–4 × ≤50 | Bullet summary |
| `callout` | `statement` ≤80, `tag` ≤20 | Important statement |
| `outro` | `ctaTop` ≤30, `channelName` ≤30, `source` ≤40 | Fixed ending |

Educator templates:

| Template | Fields | Use for |
|---|---|---|
| `definition` | `term` ≤40, `definition` ≤160, `tag` ≤20 (e.g. "Khái niệm") | "What is X?" concept card |
| `steps` | `title` ≤40, `items` 1–5 × ≤80 | Numbered how-to / process |
| `timeline` | `title` ≤40, `events` 2–5 × `{marker ≤14, text ≤70}` | Chronology, history, sequence |
| `quiz` | `question` ≤100, `options` 2–4 × ≤50, `answerIndex` (0-based) | Retention check — correct option highlights late in scene |
| `myth-fact` | `myth` ≤90, `fact` ≤90 | Misconception → correction |
| `key-point` | `point` ≤100, `tag` ≤20 (e.g. "Ghi nhớ") | The one takeaway to remember |
| `formula` | `formula` ≤60, `caption` ≤80, `label` ≤20 | Math/physics/code block |
| `chapter` | `number` ≤20 (e.g. "PHẦN 2"), `title` ≤50 | Section divider inside the lesson |

Example quiz scene:
```json
{
  "id": "body-5", "type": "body",
  "voiceText": "Câu hỏi nhanh: quang hợp tạo ra khí gì? Đáp án là oxy.",
  "templateData": {
    "template": "quiz",
    "question": "Quang hợp tạo ra khí gì?",
    "options": ["CO2", "Oxy", "Nitơ"],
    "answerIndex": 1
  }
}
```

## Workflow (MUST follow in order)

### Step 1: Detect input type
- Starts with `http://` or `https://` → URL mode
- Path ends in `.txt` or `.md` → file mode
- Otherwise → treat the argument itself as the lesson topic/outline (topic mode)

### Step 2: Get the material
- **URL mode**: use `read_url_content` (or `browser_subagent` if JS-rendered). Extract `title`, `content`, `ogImage`, `domain`. If blocked → ask user to paste material into a `.txt` file. Stop.
- **File mode**: use `view_file`. Title = first non-empty line (or `#` heading for .md), content = rest. ogImage = `null`, domain = `"local"`.
- **Topic mode**: write the outline from the argument; title = the topic. ogImage = `null`, domain = `"lesson"`.

### Step 3: Slug + output dir
Same as news skill: slug = lowercase ASCII (strip diacritics, đ→d, non-alnum → `-`, ≤40 chars); outputDir = `output/<slug>-<YYYYMMDD-HHmm>/`.

### Step 4: Generate script.json
- Follow the schema in `docs/superpowers/specs/2026-04-29-auto-news-video-design.md` Section 4 and the template table above.
- Total voiceText ~150–200 words (spoken Vietnamese), each scene 1–3 short sentences.
- **All the TTS phonetic rules from `create-news-video` apply** — spell out numbers/symbols in `voiceText` (`5.5` → `năm chấm năm`), keep visual formatting in `templateData`. See that skill's full table.
- Prefer `definition`/`steps`/`formula` for teaching; `quiz` near the end; `key-point` right before outro.

### Step 5: Self-validate
5–8 scenes, hook first, outro last, fields within limits, `answerIndex < options.length`, enums valid. Fix silently; max 2 passes.

### Step 6: Write script.json
Use `write_to_file` → `<outputDir>/script.json`.

### Step 7: Run the pipeline
```bash
npm run pipeline -- <outputDir>/script.json
```
On failure: report error + output dir path.

### Step 8: Caption (same as news skill)
Short Vietnamese caption + exactly 4 hashtags → `<outputDir>/caption.txt`.

### Step 9: Report
Same format as news skill: links to video.mp4, voice.mp3, script.txt, caption.txt + total duration.

## Sound Effects

Same 3-tier auto-selector as the news skill — **omit `sfx`** unless forcing a specific file. Educator template defaults:

| Template | Default SFX categories |
|---|---|
| `definition` | `reveal/` → `emphasis/` |
| `steps` | `transition/` → `emphasis/` |
| `timeline` | `transition/` → `cinematic/` |
| `quiz` | `drumroll/` → `countdown/` |
| `myth-fact` | `alert/` → `transition/` |
| `key-point` | `emphasis/` → `success/` |
| `formula` | `emphasis/` → `reveal/` |
| `chapter` | `cinematic/` → `transition/` |

## Edge cases

Same as `create-news-video`: paywalled/JS URL → ask for .txt; material <200 words → warn and continue; >2000 words → distill to the lesson's core concept; pipeline failure → report error + output dir.
