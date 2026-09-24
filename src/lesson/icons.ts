/**
 * Inline SVG icons: Lucide (ISC) by name, brand logos from Simple Icons (CC0)
 * with the "si:" prefix — e.g. "database", "smartphone", "si:kotlin".
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Package root, even when the package does not export ./package.json. */
function pkgDir(name: string): string {
  let dir = dirname(require.resolve(name));
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}
const LUCIDE_DIR = join(pkgDir("lucide-static"), "icons");
const SI_DIR = join(pkgDir("simple-icons"), "icons");

const cache = new Map<string, string | null>();

export function iconExists(ref: string): boolean {
  return iconSvg(ref) !== null;
}

/** Returns an <svg> string sized by CSS (width/height 1em), or null if unknown. */
export function iconSvg(ref: string | undefined): string | null {
  if (!ref) return null;
  if (cache.has(ref)) return cache.get(ref)!;
  let svg: string | null = null;
  if (ref.startsWith("si:")) {
    const file = join(SI_DIR, `${ref.slice(3)}.svg`);
    if (existsSync(file)) {
      svg = readFileSync(file, "utf8")
        .replace(/<title>.*?<\/title>/, "")
        .replace("<svg ", '<svg class="ico ico-brand" fill="currentColor" aria-hidden="true" ');
    }
  } else {
    const file = join(LUCIDE_DIR, `${ref}.svg`);
    if (existsSync(file)) {
      svg = readFileSync(file, "utf8")
        .replace(/<!--.*?-->\s*/s, "")
        .replace(/\s+width="24"\s+height="24"/, "")
        .replace(/class="[^"]*"/, 'class="ico" aria-hidden="true"')
        .replace(/\s*\n\s*/g, " ")
        .trim();
    }
  }
  cache.set(ref, svg);
  return svg;
}

/** Default icon per diagram node kind. */
export const KIND_ICON: Record<string, string> = {
  mobile: "smartphone",
  web: "monitor",
  client: "app-window",
  user: "user",
  api: "webhook",
  gateway: "network",
  server: "server",
  service: "box",
  function: "zap",
  db: "database",
  cache: "gauge",
  queue: "list-ordered",
  storage: "hard-drive",
  cloud: "cloud",
  auth: "shield-check",
  ai: "sparkles",
  external: "globe",
  module: "boxes",
};
