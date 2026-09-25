/**
 * Font fetcher — downloads Google Fonts as self-hosted woff2 files WITH the
 * Vietnamese subset, and regenerates `assets/fonts/fonts.css`.
 *
 * Why self-host: fonts loaded from the Google Fonts CDN at render time are
 * not guaranteed to be ready when HyperFrames captures frames (a test render
 * fell back to system fonts), and HyperFrames' own "deterministic" font
 * embedding only ships Latin glyphs — Vietnamese diacritics would break.
 *
 * Each family/weight is stored as 3 subset files (vietnamese, latin-ext,
 * latin) with the exact `unicode-range` Google serves, so the browser picks
 * the right file per character — same behaviour as the CDN, but offline.
 *
 * Usage:
 *   npx tsx scripts/fetch-fonts.ts            # fetch everything in FONTS
 *   npx tsx scripts/fetch-fonts.ts --force    # re-download existing files
 *
 * Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1 (Node >= 22.21).
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(__dirname, "..", "assets", "fonts");

/** Families used by the lesson style packs (src/lesson/styles/*). */
const FONTS: { family: string; weights: number[] }[] = [
  { family: "Be Vietnam Pro", weights: [400, 500, 600, 700, 800] },
  { family: "Geist Mono", weights: [400, 500, 700] },
  { family: "Space Grotesk", weights: [400, 500, 700] },
  { family: "Patrick Hand", weights: [400] },
  { family: "Chakra Petch", weights: [500, 700] },
];

const SUBSETS = ["vietnamese", "latin-ext", "latin"] as const;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const slugOf = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const oflSlugOf = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

interface Face {
  subset: string;
  weight: number;
  url: string;
  unicodeRange: string;
}

/** Parse Google's css2 response: one @font-face block per subset, preceded by a subset comment. */
function parseCss(css: string): Face[] {
  const faces: Face[] = [];
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const subset = m[1];
    const body = m[2];
    const weight = Number(body.match(/font-weight:\s*(\d+)/)?.[1] ?? 400);
    const url = body.match(/src:\s*url\(([^)]+)\)/)?.[1];
    const unicodeRange = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (url && unicodeRange) faces.push({ subset, weight, url, unicodeRange });
  }
  return faces;
}

async function main() {
  const force = process.argv.includes("--force");
  const cssRules: string[] = [];

  for (const { family, weights } of FONTS) {
    const slug = slugOf(family);
    const dir = join(FONTS_DIR, slug);
    await mkdir(dir, { recursive: true });

    const query = `${family.replace(/ /g, "+")}:wght@${weights.join(";")}`;
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${query}&display=block`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`Google Fonts CSS for "${family}" failed: HTTP ${res.status}`);
    const faces = parseCss(await res.text()).filter((f) =>
      (SUBSETS as readonly string[]).includes(f.subset),
    );
    if (!faces.some((f) => f.subset === "vietnamese")) {
      throw new Error(`"${family}" has no vietnamese subset on Google Fonts — pick another family`);
    }

    for (const face of faces) {
      const file = `${slug}-${face.weight}-${face.subset}.woff2`;
      const out = join(dir, file);
      if (force || !(await exists(out))) {
        const fontRes = await fetch(face.url);
        if (!fontRes.ok) throw new Error(`download ${face.url} failed: HTTP ${fontRes.status}`);
        await writeFile(out, Buffer.from(await fontRes.arrayBuffer()));
        console.log(`  ↓ ${slug}/${file}`);
      }
      cssRules.push(
        [
          `/* ${family} ${face.weight} — ${face.subset} */`,
          "@font-face {",
          `  font-family: '${family}';`,
          "  font-style: normal;",
          `  font-weight: ${face.weight};`,
          "  font-display: block;",
          `  src: url('${slug}/${file}') format('woff2');`,
          `  unicode-range: ${face.unicodeRange};`,
          "}",
        ].join("\n"),
      );
    }

    const license = join(dir, "OFL.txt");
    if (force || !(await exists(license))) {
      const licRes = await fetch(
        `https://raw.githubusercontent.com/google/fonts/main/ofl/${oflSlugOf(family)}/OFL.txt`,
      );
      if (licRes.ok) await writeFile(license, await licRes.text());
      else console.warn(`  ! no OFL.txt found for ${family} (HTTP ${licRes.status})`);
    }
    console.log(`✓ ${family} (${weights.join(", ")})`);
  }

  const header =
    "/* GENERATED by scripts/fetch-fonts.ts — do not edit by hand.\n" +
    "   Self-hosted Google Fonts (SIL Open Font License, see <family>/OFL.txt).\n" +
    "   URLs are relative to this file's folder (assets/fonts/). */\n\n";
  await writeFile(join(FONTS_DIR, "fonts.css"), header + cssRules.join("\n\n") + "\n");
  console.log(`\nWrote assets/fonts/fonts.css (${cssRules.length} @font-face rules)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
