---
name: create-lesson-video
description: Tạo video bài giảng lập trình, kiến trúc phần mềm, mobile fullstack cho Dan Tech — 16:9 cho YouTube (có chương) và 9:16 cho Shorts — từ ghi chú, file .md/.txt, URL hoặc một chủ đề. Viết lesson script v2 (code, diff, terminal, sơ đồ kiến trúc, layers, màn hình điện thoại, so sánh, quiz…) với lời thoại tiếng Việt có cue đồng bộ hình, dùng bộ template tin tức, infographic, năng lượng và 3D, chọn style, giọng (free/clone), SFX và nhạc theo tên file; duyệt bằng storyboard rồi render. Trigger khi user muốn tạo video bài học, video bài giảng, lesson video, video Dan Tech, video dạy Kotlin/Android/iOS/Flutter/backend/kiến trúc, hoặc cắt Shorts từ một bài học.
---

# Create Lesson Video — Dan Tech (script v2)

You turn teaching material into a branded, narrated motion-graphics lesson.
You write `script.json` (schema v2). The pipeline does the rest deterministically:
TTS with word timings → visuals synced to the words you mark → audio mix
(voice + SFX + ducked music, −14 LUFS) → HyperFrames/GSAP composition →
storyboard → MP4 + subtitles + YouTube chapters.

Read these before you write a script. They are part of this skill:

- `reference/scenes.md`: every scene type, with fields, limits, cue actions and examples
- `reference/narration.md`: Vietnamese tech narration, cue markers, pronunciation
- `reference/look-and-sound.md`: styles, SFX and music chosen by file name, mascot, formats

The schema's source of truth is `src/lesson/schema.ts`. For a complete, rendered
example, see `examples/lessons/repository-pattern/script.json`.

## Workflow

### 1. Gather the material
- **URL**: use `WebFetch` to get the title, main content and key code. If the page is paywalled or JS-only, ask the user to paste it into a `.md`/`.txt` file, then stop.
- **File**: use `Read`.
- **Topic only**: outline it yourself. Stay accurate and prefer current stable APIs (Kotlin 2.x, Jetpack Compose, Coroutines/Flow, Hilt, Ktor, SwiftUI…).
- Ask the user only when the audience level or the lesson goal is genuinely unclear.

### 2. Plan
- Pick **one core idea** and 2–4 supporting points. Each scene teaches one thing.
- **YouTube lesson** (landscape, 3–12 min), in this order:
  1. Hook (`title`/`statement`, cold open).
  2. `objectives`.
  3. `concept`.
  4. Show it: `layers` / `diagram` / `code` / `diff` / `terminal` / `phone`.
  5. `compare` or a pitfall.
  6. `quiz`.
  7. `recap`.
  8. Outro (automatic).
- Group scenes into 2–5 chapters. The chapter cards and the YouTube chapter list come from them.
- **Shorts** (portrait): write a *separate* short script with 1 chapter, 4–7 scenes and 45–90 s: hook → one visual explanation → quiz or punchline. Set `"formats": ["portrait"]` and `"intro": "none"`. A long lesson rendered in 9:16 is not a Short.
- **Pace**: the free voice speaks about 2.6 words per second, so 150 words ≈ 1 minute. Keep scenes to 6–25 s and split anything longer. Aim for a visual change (a cue) at least every 5–8 s.
- **Templates**: mix the template families into the lesson (see `scenes.md` → Template families): a hook from the four patterns, one `energy.*` scene every 20–30 s, `data.*` for numbers (always with `source`), `news.*` for news videos.
- **Style**:
  - `dantech`: default, brand look
  - `dantech-punch`: same look, faster and punchier (Shorts)
  - `blueprint`: architecture, system design
  - `whiteboard`: beginner concepts, friendly
  - `terminal`: CLI, backend, DevOps, security

### 3. Write the script
- Put it at `lessons/<slug>/script.json`. The slug is lowercase ASCII with dashes and no diacritics, e.g. `lessons/kotlin-07-repository-pattern/`. Outputs are written next to it (`landscape/`, `portrait/`, `voice/`) and are gitignored.
- Start from the example. Keep ids short and unique (`hook`, `layers`, `impl`…).
- Put **cue markers** in `voice`, so each visual appears exactly when the narrator says the word. See `narration.md`.
- Screens carry keywords; the voice explains. Never paste the narration onto the screen.
- Visible text supports `*accent*`, `==highlight==`, `**bold**` and `` `code` ``.

### 4. Validate and storyboard (always, before any render)
For a layout check in seconds, with no TTS or API keys: `npm run lesson:frames -- lessons/<slug>/script.json` (estimated timings). Then run the real storyboard:
```bash
npm run lesson:storyboard -- lessons/<slug>/script.json
```
- Schema errors are printed with their path. Fix them and rerun.
- Fix these warnings:
  - `beats reference unknown cue(s)`: add the `{marker}` to the narration.
  - `no SFX matched`: see `look-and-sound.md`.
- Open `lessons/<slug>/landscape/storyboard.jpg` (and `portrait/storyboard.jpg`) with `Read`. The full-size frames are in `storyboard/shot-NNN.png`. Check that:
  - text fits, with no clipping or overlap
  - diagram labels are readable
  - code is 14 lines or fewer
  - the mascot and its bubble cover nothing
  - Vietnamese diacritics render correctly
- To check motion and sync on a risky range, run `npm run lesson -- lessons/<slug>/script.json --format landscape --preview 60:75`. It writes `landscape/preview.mp4` at 12 fps and half size, with audio.
- Iterate until the storyboard is clean. TTS is cached per sentence, so reruns only re-synthesize what changed.

### 5. Render
```bash
npm run lesson -- lessons/<slug>/script.json                      # every format in the script
npm run lesson -- lessons/<slug>/script.json --format landscape   # one format
```
- Rendering takes about 5–6× the video length on 4 cores (a 2.5-min lesson ≈ 15 min per format). Run it in the background and keep working.
- Options: `--style <id>`, `--draft` / `--high`, `--fps 60`, `--crf 18`, `--no-storyboard`.

### 6. Publish kit
Each format folder contains `video.mp4`, `captions.srt` / `captions.vtt`, `chapters.txt`, `script.txt` and `storyboard.jpg`.

Write `lessons/<slug>/youtube.md` with:
- a title of at most 70 characters
- a description: 2–3 lines, then "Trong video:", then the contents of `landscape/chapters.txt`, then `https://dantech.academy`
- 5–8 tags
- for a Short: a one-line caption and 3–4 hashtags

For the thumbnail, suggest the hook frame `landscape/storyboard/shot-001.png` as the base.

### 7. Report
Give the video paths with their durations, the storyboard and `youtube.md`, plus any warning you could not fix.

## Voice

| `voice.profile` | What it uses | Setup |
|---|---|---|
| `free` (default) | Edge TTS (`EDGE_TTS_VOICE`, e.g. `vi-VN-NamMinhNeural` or `vi-VN-HoaiMyNeural`) + the `tech-vi` pronunciation lexicon | none |
| `clone` | The instructor's cloned voice | ElevenLabs: run `npm run voice:clone -- --name "…" samples/*.mp3 --save` (needs `ELEVENLABS_API_KEY`; model `eleven_v3`). LucyLab: set `CLONE_PROVIDER=lucylab` + `VIETNAMESE_VOICEID` |

- `VOICE_PROFILE` in `.env.local` sets the default. A script overrides it with `"voice": { "profile": "clone" }`.
- If a clone voice is not configured, the pipeline says so. Fall back to `free` and tell the user.
- Speed: `"rate": "-5%"` (Edge) or `0.9` (ElevenLabs speed, 0.7–1.2).

## Quality checklist
- [ ] The hook states a pain or a promise within 8 s. There is no "Xin chào các bạn" preamble.
- [ ] Every list, layer, row and callout is revealed with `{1}{2}…` exactly when it is spoken.
- [ ] Code scenes have 14 lines or fewer, `{L…}` follows the explanation, and notes are at most 90 characters.
- [ ] The quiz asks the question, then `{pause:3}`–`{pause:5}`, then `{answer}` with a one-sentence reason.
- [ ] The recap delivers what the objectives promised.
- [ ] English terms that the free voice mispronounces are in `assets/lexicon/tech-vi.json` or rephrased.
- [ ] You reviewed the storyboard in every format you will publish, and the pipeline printed no warnings.
