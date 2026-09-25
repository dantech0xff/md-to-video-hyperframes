/**
 * A Get Frames project folder: the agent's working directory and the only
 * place the Studio tools read scripts from or write outputs to.
 */
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class Project {
  readonly dir: string;
  /** the folder with symbolic links resolved, to compare real paths against */
  private readonly realDir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
    if (!existsSync(this.dir) || !statSync(this.dir).isDirectory()) throw new Error(`Project folder not found: ${this.dir}`);
    this.realDir = realpathSync(this.dir);
  }

  /** Absolute path for a path the agent gave; anything outside the project folder is refused, symbolic links included. */
  path(p: string): string {
    const abs = resolve(this.dir, p);
    if (!within(this.dir, abs)) throw new Error(`"${p}" is outside the project folder`);
    let real: string;
    try {
      real = realpathOfNearest(abs);
    } catch {
      throw new Error(`"${p}" is a broken symbolic link`);
    }
    if (!within(this.realDir, real)) throw new Error(`"${p}" leads outside the project folder through a symbolic link`);
    return abs;
  }

  /** Project-relative path with "/" separators, as tool results report it. */
  rel(abs: string): string {
    return relative(this.dir, abs).split(sep).join("/");
  }

  /**
   * Refuses symbolic links anywhere in folders the engine writes into: writing
   * through one would land outside the project. These folders only hold
   * generated files, so a link there never belongs.
   */
  assertNoLinks(folders: string[]): void {
    const walk = (abs: string, depth: number) => {
      const st = lstatSync(abs, { throwIfNoEntry: false });
      if (!st) return;
      if (st.isSymbolicLink()) throw new Error(`${this.rel(abs)} is a symbolic link; remove it, the Studio tools only write real files inside the project`);
      if (st.isDirectory() && depth < 6) for (const e of readdirSync(abs)) walk(join(abs, e), depth + 1);
    };
    for (const f of folders) walk(this.path(f), 0);
  }
}

function within(root: string, p: string): boolean {
  const rel = relative(root, p);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** Real path of `p`, or of its nearest existing ancestor when `p` does not exist yet; throws for a broken link. */
function realpathOfNearest(p: string): string {
  let cur = p;
  for (;;) {
    if (lstatSync(cur, { throwIfNoEntry: false })) return realpathSync(cur);
    const up = dirname(cur);
    if (up === cur) return cur;
    cur = up;
  }
}
