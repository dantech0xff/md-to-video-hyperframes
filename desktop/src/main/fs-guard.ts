/**
 * Is a path inside a folder, symbolic links included? For agent permissions
 * and the media protocol; and reading and writing the app's own files in a
 * project folder, where the agent could leave a link in their place. Links
 * are resolved one at a time, and one that leads outside is never followed.
 */
import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, realpathSync, type Stats } from "node:fs";
import { lstat, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/** Lexically inside `root` (or `root` itself). */
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
 * real or as given. The engine resolves paths the same way (src/utils/inside.ts).
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

/** `p` (relative paths count from `root`) is inside `root`, both as written and with symbolic links resolved (resolveInside). */
export function isInside(root: string, p: string): boolean {
  return resolveInside(root, resolve(root, p)) !== undefined;
}

/** `p` relative to `root`, both with symbolic links resolved; undefined when it leads outside `root`. */
export function realRelative(root: string, p: string): string | undefined {
  const to = resolveInside(root, resolve(root, p));
  try {
    return to && relative(realpathSync(root), to.real);
  } catch {
    return undefined;
  }
}

/** `p` looked up inside `root` only (resolveInside): its real path and what it is; undefined when missing or leading outside. */
export function lookInside(root: string, p: string): { real: string; st: Stats } | undefined {
  const to = resolveInside(root, p);
  const st = to && !to.missing ? lstatSync(to.real, { throwIfNoEntry: false }) : undefined;
  return to && st ? { real: to.real, st } : undefined;
}

/**
 * The text of the regular file at `p`, looked up inside `root` only
 * (resolveInside) and read without waiting on a pipe; undefined when it
 * cannot be read. For the screens: what they show from a project's files.
 */
export function readTextInside(root: string, p: string): string | undefined {
  const to = lookInside(root, p);
  if (!to?.st.isFile()) return undefined;
  let fd: number | undefined;
  try {
    // opening a named pipe waits for a writer unless non-blocking (no such flag on Windows)
    fd = openSync(to.real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    return fstatSync(fd).isFile() ? readFileSync(fd, "utf8") : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Reads `path` inside `root` from the file it opens, checked once open: a
 * regular file whose path still leads inside `root`, to that very file. A
 * link the agent left in its place cannot make the app read a file from
 * elsewhere (and write it back into the project with its next change).
 */
export async function readFileInside(root: string, path: string): Promise<string> {
  const outside = () => new Error(`${shown(root, path)} leads outside the project folder through a symbolic link`);
  // a link out of the project is never followed, not even to open it
  if (!resolveInside(root, path)) throw outside();
  // opening a named pipe waits for a writer unless non-blocking (no such flag on Windows)
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile()) throw new Error(`${shown(root, path)} is not a regular file`);
    const to = resolveInside(root, path);
    if (!to) throw outside();
    const now = to.missing ? undefined : await lstat(to.real, { bigint: true }).catch(() => undefined);
    if (!now || now.dev !== opened.dev || now.ino !== opened.ino) throw new Error(`${shown(root, path)} changed while it was read`);
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

/**
 * Writes `data` to `path` inside `root` through a new file under a random
 * name beside it, checked once it exists (inside `root`, links resolved, and
 * no other name for it), then renamed over `path`. The rename replaces a
 * link the agent left at `path` instead of following it, and a folder on the
 * way switched for a link cannot take the write out of `root`: there at most
 * the empty new file is made, and it is removed. Switched after the check,
 * the rename finds no new file there and fails.
 */
export async function writeFileInside(root: string, path: string, data: string): Promise<void> {
  const outside = () => new Error(`${shown(root, dirname(path))} leads outside the project folder through a symbolic link`);
  // a folder that leads outside now: nothing is made there
  if (!resolveInside(root, dirname(path))) throw outside();
  const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  const file = await open(tmp, "wx");
  let isOpen = true;
  let real: string | undefined;
  try {
    const made = await file.stat({ bigint: true });
    const to = resolveInside(root, tmp);
    real = to && !to.missing ? to.real : undefined;
    const now = real ? await lstat(real, { bigint: true }).catch(() => undefined) : undefined;
    // a new file has one name: another (a hard link inside `root`) could pass the check for one made elsewhere
    if (made.nlink !== 1n || !now || now.dev !== made.dev || now.ino !== made.ino) throw outside();
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
