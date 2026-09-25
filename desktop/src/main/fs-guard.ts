/** Is a path inside a folder, symbolic links included? For agent permissions and the media protocol. */
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Lexically inside `root` (or `root` itself). */
export function within(root: string, p: string): boolean {
  const rel = relative(root, p);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * `p` (relative paths count from `root`) is inside `root`, both as written and
 * after resolving symbolic links of it or of its nearest existing ancestor.
 */
export function isInside(root: string, p: string): boolean {
  const abs = resolve(root, p);
  if (!within(resolve(root), abs)) return false;
  try {
    return within(realpathSync(root), realpathOfNearest(abs));
  } catch {
    return false;
  }
}

function realpathOfNearest(p: string): string {
  let cur = p;
  for (;;) {
    if (lstatSync(cur, { throwIfNoEntry: false })) return realpathSync(cur);
    const up = dirname(cur);
    if (up === cur) return cur;
    cur = up;
  }
}
