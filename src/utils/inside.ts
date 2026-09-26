/**
 * Whether a path stays inside a folder: as written, and with symbolic links
 * resolved (a link inside the folder that points elsewhere leads outside).
 * Files another process could switch for a link (an agent's) are read and
 * written through checks made on the file opened or made, not on its path.
 */
import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

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

/**
 * Reads the file at `path` inside `root`, checked once it is open: a regular
 * file (a pipe or a device could stall the read), and `path` still leads
 * inside `root`, to that very file. Checking the path and then reading it
 * would let a symbolic link switched in between take the read elsewhere.
 * `name` is how errors call the file.
 */
export function readInside(root: string, path: string, name: string): Buffer {
  // opening a named pipe waits for a writer unless non-blocking (no such flag on Windows)
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()) throw new Error(`${name} is not a regular file`);
    const real = realpathOrNone(path);
    if (real && !within(realpathSync(root), real)) throw new Error(`${name} leads outside the project folder through a symbolic link`);
    if (!sameFile(real, opened)) throw new Error(`${name} changed while it was read`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes `data` to `path` inside `root` through a new file under a random
 * name beside it, checked once it exists (inside `root`, links resolved),
 * then renamed into place. A folder on the way switched for a symbolic link
 * cannot take the write elsewhere: there at most the empty new file is made,
 * and it is removed.
 */
export function writeInside(root: string, path: string, data: string | Uint8Array): void {
  const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(tmp, "wx");
  let open = true;
  let real: string | undefined;
  try {
    const made = fstatSync(fd, { bigint: true });
    real = realpathOrNone(tmp);
    if (!real || !within(realpathSync(root), real) || !sameFile(real, made)) {
      throw new Error(`${dirname(path)} leads outside the project folder through a symbolic link; remove the link and run again`);
    }
    writeFileSync(fd, data);
    open = false;
    closeSync(fd);
    renameSync(tmp, path);
  } catch (e) {
    try {
      if (open) closeSync(fd);
      rmSync(real ?? tmp, { force: true });
    } catch {
      // the error that matters is the first one
    }
    throw e;
  }
}

function realpathOrNone(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

/** `p` leads to the file `st` describes (same device and inode). */
function sameFile(p: string | undefined, st: BigIntStats): boolean {
  const now = p ? statSync(p, { bigint: true, throwIfNoEntry: false }) : undefined;
  return !!now && now.dev === st.dev && now.ino === st.ino;
}
