/**
 * Is a path inside a folder, symbolic links included? For agent permissions
 * and the media protocol; and reading and writing the app's own files in a
 * project folder, where the agent could leave a link in their place.
 */
import { randomBytes } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { open, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

/** `p` relative to `root`, both with symbolic links resolved; undefined when that fails. */
export function realRelative(root: string, p: string): string | undefined {
  try {
    return relative(realpathSync(root), realpathOfNearest(resolve(root, p)));
  } catch {
    return undefined;
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

/**
 * Reads `path` inside `root` from the file it opens, checked once open: a
 * regular file whose path still leads inside `root`, to that very file. A
 * link the agent left in its place cannot make the app read a file from
 * elsewhere (and write it back into the project with its next change).
 */
export async function readFileInside(root: string, path: string): Promise<string> {
  // opening a named pipe waits for a writer unless non-blocking (no such flag on Windows)
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile()) throw new Error(`${shown(root, path)} is not a regular file`);
    const real = await realpath(path).catch(() => undefined);
    if (real && !within(await realpath(root), real)) throw new Error(`${shown(root, path)} leads outside the project folder through a symbolic link`);
    const now = real ? await stat(real, { bigint: true }).catch(() => undefined) : undefined;
    if (!now || now.dev !== opened.dev || now.ino !== opened.ino) throw new Error(`${shown(root, path)} changed while it was read`);
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

/**
 * Writes `data` to `path` inside `root` through a new file under a random
 * name beside it, checked once it exists (inside `root`, links resolved),
 * then renamed over `path`. The rename replaces a link the agent left at
 * `path` instead of following it, and a folder on the way switched for a
 * link cannot take the write out of `root`: there at most the empty new
 * file is made, and it is removed.
 */
export async function writeFileInside(root: string, path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  const file = await open(tmp, "wx");
  let isOpen = true;
  let real: string | undefined;
  try {
    const made = await file.stat({ bigint: true });
    real = await realpath(tmp).catch(() => undefined);
    const now = real ? await stat(real, { bigint: true }).catch(() => undefined) : undefined;
    if (!real || !now || now.dev !== made.dev || now.ino !== made.ino || !within(await realpath(root), real)) {
      throw new Error(`${shown(root, dirname(path))} leads outside the project folder through a symbolic link`);
    }
    await file.writeFile(data);
    isOpen = false;
    await file.close();
    await rename(tmp, path);
  } catch (e) {
    if (isOpen) await file.close().catch(() => undefined);
    await rm(real ?? tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** `p` as the user knows it: relative to the project folder. */
function shown(root: string, p: string): string {
  return relative(root, p) || ".";
}
