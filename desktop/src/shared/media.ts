/** URLs of project files for the renderer, served by the main process (gf-media://). */
export const MEDIA_SCHEME = "gf-media";

/** gf-media://local/<absolute path>; `version` makes the renderer reload a rebuilt file. */
export function mediaUrl(path: string, version?: string | number): string {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean).map(encodeURIComponent);
  // Windows drive letters keep their colon: /C:/Users/…
  const url = `${MEDIA_SCHEME}://local/${segments.join("/").replace(/^([A-Za-z])%3A/, "$1:")}`;
  return version === undefined ? url : `${url}?v=${encodeURIComponent(String(version))}`;
}

/** The absolute path in a media URL. */
export function mediaPath(url: string, platform: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.host !== "local") return undefined;
  const path = decodeURIComponent(parsed.pathname);
  if (platform === "win32") return /^\/[A-Za-z]:\//.test(path) ? path.slice(1).replace(/\//g, "\\") : undefined;
  return path;
}
