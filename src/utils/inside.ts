/**
 * Whether a path stays inside a folder: as written, and with symbolic links
 * resolved (a link inside the folder that points elsewhere leads outside).
 */
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";

/** `p` is `root` or inside it, as written. */
export function within(root: string, p: string): boolean {
  const rel = relative(root, p);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** Real path of `p`, or of its nearest existing ancestor when `p` does not exist yet; throws for a broken link. */
export function realpathOfNearest(p: string): string {
  let cur = p;
  for (;;) {
    if (lstatSync(cur, { throwIfNoEntry: false })) return realpathSync(cur);
    const up = dirname(cur);
    if (up === cur) return cur;
    cur = up;
  }
}
