/**
 * A Get Frames project folder: the agent's working directory and the only
 * place the Studio tools read scripts from or write outputs to.
 */
import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class Project {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
    if (!existsSync(this.dir) || !statSync(this.dir).isDirectory()) throw new Error(`Project folder not found: ${this.dir}`);
  }

  /** Absolute path for a path the agent gave; anything outside the project folder is refused. */
  path(p: string): string {
    const abs = resolve(this.dir, p);
    const rel = relative(this.dir, abs);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`"${p}" is outside the project folder`);
    return abs;
  }

  /** Project-relative path with "/" separators, as tool results report it. */
  rel(abs: string): string {
    return relative(this.dir, abs).split(sep).join("/");
  }
}
