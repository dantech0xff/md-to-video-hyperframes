---
name: testing-get-frames-desktop
description: How to run and seed the Get Frames Electron desktop app for end-to-end testing on a headless-capable Linux desktop (display :0), without AI agent credentials.
---

# Testing the Get Frames desktop app end-to-end

## Launch

```bash
cd desktop && DISPLAY=:0 npm run dev   # electron-vite dev; window opens on :0
```

- If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary was never downloaded:
  `node desktop/node_modules/electron/install.js` (downloads ~100 MB into `desktop/node_modules/electron/dist/`).
- In dev mode the app's userData is `~/.config/Get Frames Dev` (not the packaged `Get Frames`).
- `window.confirm` dialogs render as small native windows with OK/Cancel — click OK directly.

## Skipping the setup screen

`App.tsx` gates on `setup:status().done`. To land on the project list immediately, write
`~/.config/Get Frames Dev/settings.json` BEFORE launching:

```json
{ "projectsDir": "/home/ubuntu/Videos/Get Frames", "setupDone": true }
```

(Projects dir defaults to `~/Videos/Get Frames`; readSettings merges the file over defaults, so a partial file is fine.)

## Chrome headless for storyboard builds

`setup.chrome` looks for chrome-headless-shell at the HyperFrames-pinned build inside `<userData>/browsers`.
Pre-install it instead of clicking "Tải Chrome headless" (~100 MB download through the UI):

```bash
node -e 'import("@puppeteer/browsers").then(b=>b.install({cacheDir:"/home/ubuntu/.config/Get Frames Dev/browsers",browser:b.Browser.CHROMEHEADLESSSHELL,buildId:"<PIN>"}))'
```

Get `<PIN>` via `node -e 'import("./dist/studio/engine.js").then(m=>console.log(m.hyperframesChromeBuild()))'` at repo root (0.8.78 pins 152.0.7977.30). ffmpeg must exist on PATH. Edge TTS narration needs network to speech.platform.bing.com.

## Seeding a project without an agent

Creating a project via the UI launches a real AI agent (needs credentials). Instead seed a folder under the projects dir:

- `project.json`: `{version:1, title, kind:"short"|"lesson"|"news", request:{topic,notes,style:"whiteboard",voice:"free",brand:"dan-tech"}, sources:[], agent:{id:"claude-code"}, createdAt, updatedAt}` — kind decides script paths (`videoTargets` in desktop/src/main/projects.ts): `short`/`news` → `script.json` at root; `lesson` → `script.json` + `short/script.json`.
- `script.json`: copy `examples/lessons/short-launch-vs-async/script.json` or craft one — validate it first with
  `node -e 'import("./dist/studio/engine.js").then(m=>console.log(m.validateScript(new m.Project("<dir>"),"script.json")))'`.

With no agent session the project shows agentState `idle`, so agent-busy-disabled buttons stay enabled. The Storyboard tab lists scenes from the script even with no storyboard built ("Chưa có storyboard…" banner). Storyboard row keys: `intro`, `chapter-N`, scene `id` (or `s<n>`), `outro` — `s.kind !== "intro"` gates the Sửa/Xoá buttons.

## Useful facts

- OS trash on this Linux image: `~/.local/share/Trash/files` (+ `info/*.trashinfo` recording the original path). Restore by `mv`ing the folder back (delete the .trashinfo); the projects list refreshes on remount (click another nav item, then back).
- Storyboard rebuild after a script edit: narration step (edge-tts, ~1-3 s/uncached sentence) then capture (~1 s/scene). Small scripts rebuild in ~5-8 s — too fast to race a job-dependent action (e.g. `projects:delete` refusal); use ≥12 fresh scenes for a ~40 s window.
- Engine host runs `dist/studio/engine.js` via an Electron utility process: `npm run build` at repo root must be current. After switching branches always restart `npm run dev` (and re-check `pgrep -f electron` leftovers; `wmctrl -l` shows the "Get Frames" window when up).
- App logs: `~/.config/Get Frames Dev/logs/{main,engine,agent}.log`.

## Storyboard CRUD UI specifics (script:*/review flows)

- Row button clusters differ per kind — scene rows: Sửa ↑ ↓ ⧉ 🗑; chapter card rows: Sửa ↑ ↓ 🗑 (no ⧉); outro: Sửa 🗑; intro: nothing. Positions shift between row types (~15 px) — zoom on the buttons before clicking, don't reuse scene-row coordinates for card rows.
- Sửa opens the `SceneEditor` INLINE inside the row (not a modal) — it expands below the row; scroll down to see it. Its editor covers chapter cards too ("Sửa thẻ chương").
- Error banners (`ErrorBanner` for send/del/mut errors) render at the BOTTOM of the storyboard list, just above "Ghi chú chung" — a conflict/error is easy to miss if you're scrolled mid-list. The rebuild "Đang dựng lại storyboard…" banner and the stale "Kịch bản đã đổi…" banner render at the TOP instead.
- After every successful part op the review reloads and the list scrolls to top — plan scrolls accordingly. `End`/`Home` keys jump the list when it has focus (click blank space in the content first).
- Dashed `.add-strip` after each chapter's last scene = one `<select>` (all 33-34 scene types) + "Thêm cảnh"; for `card:false` chapters the strip also carries the chapter title + ↑↓ (that's where those chapters' moves live). The bottom strip is "+ Thêm chương". All strips share ONE controlled `typePicker` value — changing any select updates them all.
- The type `<select>` dropdown is a native popup — its clicks are best-effort; when it doesn't open at the bottom of a long list, scroll the strip to mid-screen and retry, or just click "Thêm cảnh" with the already-picked type.
- Version-conflict recipe: while the tab is loaded, `sed`-edit a voice line inside script.json → click any move/add → engine sees stale `version` → review auto-reloads and the bottom banner shows "Kịch bản vừa đổi — đã tải lại, thử lại." The op is refused (nothing written); a retry succeeds on the fresh version. External edits don't emit `event:projects`, so the UI stays stale until a mutate forces reload.
- `chapterIndex`/row keys renumber when chapters collapse or reorder (`chapter-4`→`chapter-3`…); re-locate buttons by label/meta, not by remembered key.
- freshId rule: id base = scene type slug, suffix `-2`,`-3`… taken from ALL chapters; duplicates get `<id>-copy`. Verify ids in script.json with python after each op — the UI rows only show what the review re-read.
- Edge moves are prevented client-side (`canMove` disables ↑/↓ at edges) — verify via faded icon + click = no-op; the engine's "Phần này đã ở đầu/cuối" refusal is unreachable through the UI.
