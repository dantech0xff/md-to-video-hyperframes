/**
 * The Chrome that HyperFrames renders with: chrome-headless-shell at the build
 * the locked HyperFrames version pins. The desktop app downloads it into its
 * own data folder on first run, then passes it on as HYPERFRAMES_BROWSER_PATH
 * (read by HyperFrames and by the storyboard). Terminal users keep
 * `npx hyperframes browser ensure`.
 */
import { readFileSync } from "node:fs";
import { Browser, detectBrowserPlatform, getInstalledBrowsers, install } from "@puppeteer/browsers";
import { hyperframesCli } from "./binaries.js";

/** What HyperFrames 0.4.34 pins; used only if its CLI can no longer be read. */
const FALLBACK_BUILD = "131.0.6778.85";

let build: string | undefined;

/** The chrome-headless-shell build the locked HyperFrames CLI downloads itself. */
export function hyperframesChromeBuild(): string {
  if (build) return build;
  try {
    build = /CHROME_VERSION\s*=\s*"(\d+\.\d+\.\d+\.\d+)"/.exec(readFileSync(hyperframesCli(), "utf8"))?.[1] ?? FALLBACK_BUILD;
  } catch {
    build = FALLBACK_BUILD;
  }
  return build;
}

/** Executable of the pinned build if it is already in `cacheDir`. */
export async function installedChrome(cacheDir: string): Promise<string | undefined> {
  const found = await getInstalledBrowsers({ cacheDir }).catch(() => []);
  return found.find((b) => b.browser === Browser.CHROMEHEADLESSSHELL && b.buildId === hyperframesChromeBuild())?.executablePath;
}

/** Downloads the pinned build into `cacheDir` (about 90–120 MB) unless it is there; resolves with its executable. */
export async function installChrome(cacheDir: string, onProgress?: (percent: number) => void): Promise<string> {
  const existing = await installedChrome(cacheDir);
  if (existing) return existing;
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`Chrome headless is not available for ${process.platform}/${process.arch}`);
  let last = -1;
  const installed = await install({
    cacheDir,
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId: hyperframesChromeBuild(),
    platform,
    downloadProgressCallback: (done, total) => {
      const percent = total > 0 ? Math.floor((done / total) * 100) : 0;
      if (percent !== last) onProgress?.((last = percent));
    },
  });
  return installed.executablePath;
}
