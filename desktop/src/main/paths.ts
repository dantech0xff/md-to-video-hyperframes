/**
 * Where things live (design doc §7). In development the engine is this repo's
 * checkout (desktop/ sits inside it); in the packaged app it is
 * resources/engine, staged by `npm run stage-engine`.
 */
import { join, resolve } from "node:path";

export interface AppPaths {
  userData: string;
  settings: string;
  secrets: string;
  /** Chrome headless downloaded on first run */
  browsers: string;
  brands: string;
  sfx: string;
  music: string;
  logs: string;
  engineRoot: string;
  /** the skills copied into every project */
  skills: string;
  /** out/main: the engine host and agent launcher are built next to the main bundle */
  mainDir: string;
  preload: string;
  defaultProjectsDir: string;
}

export function appPaths(o: { userData: string; videos: string; packaged: boolean; resourcesPath: string; mainDir: string }): AppPaths {
  const engineRoot = o.packaged ? join(o.resourcesPath, "engine") : resolve(o.mainDir, "..", "..", "..");
  return {
    userData: o.userData,
    settings: join(o.userData, "settings.json"),
    secrets: join(o.userData, "secrets.bin"),
    browsers: join(o.userData, "browsers"),
    brands: join(o.userData, "brands"),
    sfx: join(o.userData, "sounds", "sfx"),
    music: join(o.userData, "sounds", "music"),
    logs: join(o.userData, "logs"),
    engineRoot,
    skills: join(engineRoot, ".agents", "skills"),
    mainDir: o.mainDir,
    preload: join(o.mainDir, "..", "preload", "index.cjs"),
    defaultProjectsDir: join(o.videos, "Get Frames"),
  };
}
