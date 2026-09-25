/**
 * Moving finished files into place. A rename replaces the old file at once on
 * macOS and Linux. Windows refuses to replace a file another program has open
 * (the desktop app's player streaming the last video) but lets that file be
 * renamed: the old one moves aside first and is deleted as soon as nothing
 * reads it. It also refuses to rename a folder that holds an open file, so a
 * folder is merged file by file instead of swapped whole.
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const ASIDE = ".replaced-";
/** what Windows says for a destination in use, and every system for one of another kind */
const IN_THE_WAY = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY", "EEXIST", "EISDIR", "ENOTDIR"]);

/** Moves the file or folder `from` to `to`, replacing what is there; a folder keeps only what `from` has. */
export async function replacePath(from: string, to: string): Promise<void> {
  if ((await lstat(from)).isDirectory()) return replaceFolder(from, to);
  try {
    await rename(from, to);
    return;
  } catch (e) {
    if (!IN_THE_WAY.has((e as NodeJS.ErrnoException).code ?? "") || !(await lstat(to).catch(() => undefined))) throw e;
  }
  const aside = await moveAside(to);
  try {
    await rename(from, to);
  } catch (e) {
    await rename(aside, to).catch(() => undefined);
    throw e;
  }
  // gone now, or (Windows) once the program that has it open lets go of it
  await rm(aside, { recursive: true, force: true }).catch(() => undefined);
}

/** Removes what replacePath moved aside in `dir` and could not delete then. */
export async function removeReplaced(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.filter((n) => n.startsWith(ASIDE)).map((n) => rm(join(dir, n), { recursive: true, force: true }).catch(() => undefined)));
}

async function replaceFolder(from: string, to: string): Promise<void> {
  // a file or a link in the way goes; a folder there is filled in, never followed through a link
  const there = await lstat(to).catch(() => undefined);
  if (there && !there.isDirectory()) await rm(await moveAside(to), { recursive: true, force: true }).catch(() => undefined);
  await mkdir(to, { recursive: true });
  const names = await readdir(from);
  for (const name of names) await replacePath(join(from, name), join(to, name));
  // what the old folder had and the new one does not (best effort: a file still open stays until next time)
  const keep = new Set(names);
  for (const name of await readdir(to)) {
    if (!keep.has(name)) await rm(join(to, name), { recursive: true, force: true }).catch(() => undefined);
  }
  await rm(from, { recursive: true, force: true });
}

async function moveAside(path: string): Promise<string> {
  const aside = join(dirname(path), `${ASIDE}${randomUUID().slice(0, 8)}-${basename(path)}`);
  await rename(path, aside);
  return aside;
}
