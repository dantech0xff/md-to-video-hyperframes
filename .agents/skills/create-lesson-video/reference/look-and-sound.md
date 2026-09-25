# Look and sound: style, SFX, music, mascot, formats

## Style packs (`"style"`, or `--style` on the command line)

| Style | Look | Motion | Use for |
|---|---|---|---|
| `dantech` (default) | Dark, brand blue #0091FF, text wordmark, one font, no borders | Energetic expo easing, push/wipe transitions, hook beat | Most lessons, brand consistency |
| `dantech-punch` | Same look as `dantech` | About 40% faster, harder pops, louder SFX | Shorts and high-energy lessons |
| `blueprint` | Navy blueprint grid, white line art, Space Grotesk | Calm, "write-on" text, wipe/blinds | Architecture, system design, backend flows |
| `whiteboard` | Paper, hand-drawn boxes, Patrick Hand | Friendly, slide/iris | Beginner concepts, analogies |
| `terminal` | Black + neon green, scanlines, Chakra Petch | Glitch transitions, scrambled text | CLI, DevOps, security, Git, backend |

The style drives colours, fonts, code theme, easing, transitions, SFX word preferences, music mood and the mascot's look.
To compare, run the same script with `--storyboard --style whiteboard` and so on.

## Sound effects, chosen by file name

The user's library lives in `assets/sfx/` (or `SFX_DIR`), with files named after what they are:
`transition/whoosh-soft.mp3`, `ui/pop-bubble.mp3`, `quiz/tick-tock-clock.mp3`, `brand/logo-riser-intro.mp3`…

- **Don't list sounds by hand.** The pipeline adds them to events automatically: transitions, reveals, code focus, diagram flows, taps, typing, quiz countdown and answer, chapter cards, intro and outro. Each style has an ordered keyword list per event (`src/lesson/styles/<id>/style.json` → `sfx`). The first keyword that matches a file name wins.
- **See what a lesson will use:** run `npm run audio:catalog` (or `-- --style terminal`). It writes `assets/sfx/catalog.json` and `assets/music/catalog.json` (name, duration, tags) and prints the file each event resolves to. Read `catalog.json` when you want to pick a specific sound for a mood.
- **Override only for a reason**, such as a special moment or a mood change:
  ```json
  "sfx": [{ "at": "boom", "name": "brand/impact-boom", "volume": 0.5 }]
  "beats": [{ "at": "{2}", "do": "reveal", "target": 2, "sfx": "sparkle" }]
  "beats": [{ "at": "net", "do": "focus", "lines": "8", "sfx": false }]
  ```
  `name` accepts an exact path (`ui/ding-bell`), a file name (`ding-bell`) or keywords (`"tick tock"`, which needs every word to match). Diacritics are ignored.
- Loudness is automatic: each SFX is peak-normalized, then mixed at the style's per-event volume, and the final mix is −14 LUFS.
- An empty library is filled with a synthesized placeholder pack in `_starter/`. The user's own files always win over it. Tell the user when the render ran on placeholders.
- `no SFX matched: X`: there is no file for that event's keywords. Suggest a file name to the user (for example `ui/pop-*.mp3`), or ignore it.

## Background music, chosen by file name

The music library lives in `assets/music/` (or `MUSIC_DIR`). Files are named by mood and genre, e.g. `lofi-chill-coding.mp3` or `ambient-calm-architecture.mp3`.

- By default each style picks by mood keywords:
  - dantech: tech › lofi › chill
  - blueprint: architecture › ambient › calm
  - whiteboard: acoustic › happy
  - terminal: synthwave › cyber › electronic
- To force a track: `"music": { "track": "lofi-chill-coding", "volume": 0.14 }`. For no music: `"music": "none"`.
- The track is looped, faded in and out, normalized to −14 LUFS before the volume is applied, and ducked under the voice automatically.
- Guidance:
  - Long lessons: calm, no lyrics, little percussion.
  - Shorts: more energy.
  - Quiz or "hands-on" moments: the pause already carries tension, so don't add more music.

## Mascot

The Dan Tech brand has **no mascot**: its `brand.json` doesn't define one, so leave `mascot` out of Dan Tech scripts. The notes below apply to brand kits that define one.

The built-in mascot "Dan Bot" is a small robot. Its colours follow the style: marker lines on whiteboard, neon on terminal, line art on blueprint. It pops in, floats, blinks, and its mouth moves with the narration.

- **Automatic** (`"mascot": "auto"` at the script level, the default):
  - intro: waves
  - quiz: thinks during the countdown, celebrates when the answer appears
  - outro: waves goodbye
- **Per scene**: `"mascot": "point"` or `{ "pose": "point", "say": "Nhớ khái niệm này nhé!" }`.
  - Poses: `idle`, `wave`, `point` (toward the content), `think`, `celebrate`.
  - `say`: a speech bubble of at most 48 characters, 2–5 words that add personality ("Mẹo nhỏ!", "Chỗ này hay sai!"). Never repeat the narration.
  - `side`: `left` or `right`. Defaults are right in 16:9 and left in 9:16, at the bottom corner.
  - `talk: false` keeps the mouth still.
- Use it on **1–3 scenes per lesson** where the bottom corner is free: title, statement, concept, objectives/recap with 3 items or fewer. Never use it on code, diff, diagram, layers, compare or phone scenes, which are busy. Check the storyboard for overlaps.
- `"mascot": false` on a scene hides it, and `"mascot": "off"` at the script level disables it everywhere.
- Own art: set `brand.json` → `"mascot": { "name": "…", "kind": "image", "poses": { "idle": "mascot/idle.png", "wave": "mascot/wave.png", … } }`. Use transparent PNGs about 600 px tall; a missing pose falls back to `idle`.

## Template families and the energy rules

The template types (`news.*`, `data.*`, `energy.*`, `3d.*`, `lesson.compare`) switch the background, the shell and the caption colours by family. Energy scenes play one `impact` sound (style keywords `impact`, `hit`, `boom`, `punch`). The hook beat plays whoosh, pop and ding on its own. See `docs/dan-tech/templates.md` for the rules. In short: one energy scene every 20–30 s, after 3–4 dark scenes one full-bleed accent scene, and never open on the logo.

## Formats

| Format | Size | Use | Notes |
|---|---|---|---|
| `landscape` | 1920×1080 | YouTube lessons | Intro sting after the cold open, chapter pills, progress bar |
| `portrait` | 1080×1920 | Shorts, Reels, TikTok | No intro sting, burned-in karaoke captions (`captions.burn: "auto"`): spoken words white, the current word on an accent block, the rest dimmed |

- `"formats": ["landscape", "portrait"]` renders both from one script. Layouts adapt: diagrams go top-to-bottom, lists stack.
- Safe areas: keep critical text out of the bottom ~250 px of 9:16 (the platform UI covers it). The pipeline's portrait layout already does this.
- Captions: `"captions": { "burn": true }` burns them into 16:9 too. `captions.srt` and `captions.vtt` are always written for YouTube upload.
