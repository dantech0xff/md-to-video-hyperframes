/**
 * Sound library catalog.
 *
 *   npm run audio:catalog                    # all styles
 *   npm run audio:catalog -- --style terminal
 *
 * Scans assets/sfx and assets/music (or SFX_DIR / MUSIC_DIR), writes
 * catalog.json into each folder (name, duration, tags), and prints which file
 * every style event would pick — so you can check the mood before rendering.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { writeCatalog, scanSounds, resolveFirst, sfxDir, musicDir } from "../src/lesson/sound-library.js";
import { listStyles, loadStyle } from "../src/lesson/styles.js";

async function main() {
  const i = process.argv.indexOf("--style");
  const styles = i > 0 ? [process.argv[i + 1]] : listStyles();

  const sfx = await writeCatalog(sfxDir());
  const music = await writeCatalog(musicDir());
  const own = (n: string) => !n.startsWith("_starter/");
  console.log(`SFX:   ${sfx.length} file(s) (${sfx.filter((e) => own(e.name)).length} yours) → ${sfxDir()}/catalog.json`);
  console.log(`Music: ${music.length} file(s) (${music.filter((e) => own(e.name)).length} yours) → ${musicDir()}/catalog.json`);
  if (sfx.length + music.length === 0) {
    console.log("\nLibrary is empty — add files (see assets/sfx/README.md) or run `npm run sounds:starter`.");
    return;
  }

  const sfxItems = scanSounds(sfxDir());
  const musicItems = scanSounds(musicDir());
  for (const id of styles) {
    const st = loadStyle(id);
    console.log(`\n── ${st.id} (${st.name})`);
    for (const [event, prefs] of Object.entries(st.sfx)) {
      const hit = resolveFirst(prefs, sfxItems, "catalog");
      console.log(`  ${event.padEnd(11)} ${hit ? hit.name : "— (no match: " + prefs.join(" | ") + ")"}`);
    }
    const m = resolveFirst(st.music, musicItems, "catalog");
    console.log(`  ${"music".padEnd(11)} ${m ? m.name : "— (no match: " + st.music.join(" | ") + ")"}`);
  }
  console.log("\nEvents with several matching files pick one deterministically per lesson/scene.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
