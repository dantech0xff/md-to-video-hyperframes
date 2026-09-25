/**
 * Moving finished files into place. A rename replaces the old file at once on
 * macOS and Linux. Windows refuses to replace a file another program has open
 * (the desktop app's player streaming the last video) or a folder that holds
 * one, but it lets that file be renamed: the old one moves aside first and is
 * deleted as soon as nothing reads it.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const ASIDE = ".replaced-";
/** what Windows says for a destination in use, and every system for a folder that is not empty */
const IN_THE_WAY = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY", "EEXIST", "EISDIR", "ENOTDIR"]);

/** Moves the file or folder `from` to `to`, replacing what is there. */
export async function replacePath(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
    return;
  } catch (e) {
    if (!IN_THE_WAY.has((e as NodeJS.ErrnoException).code ?? "") || !(await lstat(to).catch(() => undefined))) throw e;
  }
  const aside = join(dirname(to), `${ASIDE}${randomUUID().slice(0, 8)}-${basename(to)}`);
  await rename(to, aside);
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
