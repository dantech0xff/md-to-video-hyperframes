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

/**
 * Throws unless folder `dir` (which may not exist yet) leads inside `root`
 * with symbolic links resolved: checked right before writing there, since
 * another process can switch a folder for a link at any time.
 */
export function assertRealInside(root: string, dir: string): void {
  let real: string | undefined;
  try {
    real = realpathOfNearest(dir);
  } catch {
    // a broken link
  }
  if (!real || !within(realpathSync(root), real)) throw new Error(`${dir} leads outside the project folder through a symbolic link; remove the link and run again`);
}
