/**
 * Whether a path stays inside a folder: as written, and with symbolic links
 * resolved (a link inside the folder that points elsewhere leads outside).
 * Links are resolved one at a time, and one that leads outside is never
 * followed. Files another process could switch for a link (an agent's) are
 * read and written through checks made on the file opened or made, not on
 * its path.
 */
import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync, type BigIntStats, type Stats } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/** `p` is `root` or inside it, as written. */
export function within(root: string, p: string): boolean {
  const rel = relative(root, p);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** Links followed on one path before it counts as a loop, as the system does. */
const MAX_LINKS = 40;

/**
 * Where `p` leads, found one name at a time from `root`'s real path: each
 * symbolic link on the way is read (readlink) and followed only when its
 * target, as written, stays inside `root`. Nothing outside `root` is looked
 * up: realpath or stat would follow the link, and on Windows looking up a
 * network path (\\host\share) connects to that machine and offers the user's
 * credentials. An absolute target counts when written under `root`'s path,
 * real or as given.
 *
 * Returns the real path, or when a name on the way is missing, where `p`
 * would be made (`missing`). Undefined when `p` leads outside `root`, as
 * written or through a link, or loops.
 */
export function resolveInside(root: string, p: string): { real: string; missing: boolean } | undefined {
  const base = resolve(root);
  if (!within(base, resolve(p))) return undefined;
  try {
    const realRoot = realpathSync(base);
    const todo = names(relative(base, resolve(p)));
    let cur = realRoot;
    let links = 0;
    while (todo.length) {
      const name = todo.shift()!;
      if (name === "..") {
        cur = dirname(cur);
        if (!within(realRoot, cur)) return undefined;
        continue;
      }
      const next = join(cur, name);
      const st = lstatSync(next, { throwIfNoEntry: false });
      if (!st) {
        const real = join(next, ...todo);
        return within(realRoot, real) ? { real, missing: true } : undefined;
      }
      if (!st.isSymbolicLink()) {
        cur = next;
        continue;
      }
      if (++links > MAX_LINKS) return undefined;
      const target = readlinkSync(next);
      if (isAbsolute(target)) {
        const rest = namesUnder(target, realRoot) ?? namesUnder(target, base);
        if (!rest) return undefined;
        todo.unshift(...rest);
        cur = realRoot;
      } else {
        // a drive of its own ("C:photo.jpg" on Windows) is not relative to the link's folder
        if (parse(target).root) return undefined;
        todo.unshift(...names(target));
      }
    }
    return { real: cur, missing: false };
  } catch {
    // a name the system refuses, or a folder that went away meanwhile: nothing to vouch for
    return undefined;
  }
}

/** The names a relative path is made of, "." left out. */
function names(rel: string): string[] {
  return rel.split(process.platform === "win32" ? /[\\/]+/ : /\/+/).filter((n) => n && n !== ".");
}

/** The names of absolute path `target` below folder `dir`, as written (any case on Windows); undefined when not below it. */
function namesUnder(target: string, dir: string): string[] | undefined {
  const fold = (s: string) => (process.platform === "win32" ? s.replace(/\//g, "\\").toLowerCase() : s);
  const t = fold(target);
  const d = fold(dir).replace(/[\\/]+$/, "");
  if (t === d) return [];
  return t.startsWith(d + sep) ? names(t.slice(d.length + 1)) : undefined;
}

/** `p` looked up inside `root` only (resolveInside): its real path and what it is; undefined when missing or leading outside. */
export function lookInside(root: string, p: string): { real: string; st: Stats } | undefined {
  const to = resolveInside(root, p);
  const st = to && !to.missing ? lstatSync(to.real, { throwIfNoEntry: false }) : undefined;
  return to && st ? { real: to.real, st } : undefined;
}

/**
 * Throws unless folder `dir` (which may not exist yet) leads inside `root`
 * with symbolic links resolved (resolveInside): checked right before writing
 * there, since another process can switch a folder for a link at any time.
 */
export function assertRealInside(root: string, dir: string): void {
  if (!resolveInside(root, dir)) throw new Error(`${dir} leads outside the project folder through a symbolic link; remove the link and run again`);
}

/**
 * Reads the file at `path` inside `root`: opened only when it leads inside
 * (resolveInside), and checked once open: a regular file (a pipe or a device
 * could stall the read), and `path` still leads inside `root`, to that very
 * file. Checking the path and then reading it would let a symbolic link
 * switched in between take the read elsewhere. `name` is how errors call the
 * file. `changedAt`: when the file read last changed or was replaced (ms);
 * `fileId`: which file it is (its inode number), told apart from another
 * that takes its path.
 */
export function readInside(root: string, path: string, name: string): { data: Buffer; changedAt: number; fileId: string } {
  if (!resolveInside(root, path)) throw new Error(`${name} leads outside the project folder through a symbolic link`);
  // opening a named pipe waits for a writer unless non-blocking (no such flag on Windows)
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()) throw new Error(`${name} is not a regular file`);
    const to = resolveInside(root, path);
    if (!to) throw new Error(`${name} leads outside the project folder through a symbolic link`);
    if (to.missing || !sameFile(to.real, opened)) throw new Error(`${name} changed while it was read`);
    // times as statSync gives them (fractional ms), to compare with later lookups of the same file
    const times = fstatSync(fd);
    return { data: readFileSync(fd), changedAt: Math.max(times.mtimeMs, times.ctimeMs), fileId: String(opened.ino) };
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes `data` to `path` inside `root` through a new file under a random
 * name beside it, checked once it exists (inside `root`, links resolved, and
 * no other name for it), then renamed into place. A folder on the way
 * switched for a symbolic link cannot take the write elsewhere: there at most
 * the empty new file is made, and it is removed. Switched after the check,
 * the rename finds no new file there and fails.
 */
export function writeInside(root: string, path: string, data: string | Uint8Array): void {
  const outside = new Error(`${dirname(path)} leads outside the project folder through a symbolic link; remove the link and run again`);
  // a folder that leads outside now: nothing is made there
  if (!resolveInside(root, dirname(path))) throw outside;
  const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(tmp, "wx");
  let open = true;
  let real: string | undefined;
  try {
    const made = fstatSync(fd, { bigint: true });
    const to = resolveInside(root, tmp);
    real = to && !to.missing ? to.real : undefined;
    // a new file has one name: another (a hard link inside `root`) could pass the check for one made elsewhere
    if (made.nlink !== 1n || !real || !sameFile(real, made)) throw outside;
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

/** `real`, a path resolveInside gave, is the file `st` describes (same device and inode). */
function sameFile(real: string, st: BigIntStats): boolean {
  const now = lstatSync(real, { bigint: true, throwIfNoEntry: false });
  return !!now && now.dev === st.dev && now.ino === st.ino;
}
