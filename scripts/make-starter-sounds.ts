/**
 * Starter sound pack — placeholder SFX + one music loop synthesized with
 * ffmpeg into assets/sfx/_starter and assets/music/_starter. Your own files
 * always win over them (see assets/sfx/README.md).
 *
 *   npm run sounds:starter            # create missing files
 *   npm run sounds:starter -- --force # regenerate everything
 */
import { makeStarterSounds } from "../src/lesson/starter-sounds.js";

makeStarterSounds({ force: process.argv.includes("--force") })
  .then((n) => {
    console.log(`starter pack: ${n} file(s) written → assets/sfx/_starter, assets/music/_starter`);
    console.log("Add your own sounds next to them (see assets/sfx/README.md); yours are always preferred.");
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
