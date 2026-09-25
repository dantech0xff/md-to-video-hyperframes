/**
 * Serves project images and videos to the renderer, which cannot read files:
 * gf-media://local/<absolute path>. Only files inside the folders the app
 * allows are served, and video seeking gets byte ranges.
 */
import { createReadStream, statSync } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { MEDIA_SCHEME, mediaPath } from "../shared/media";
import { isInside } from "./fs-guard";

export const MEDIA_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, stream: true } as const;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".vtt": "text/vtt",
  ".srt": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export function serveMedia(request: Request, roots: string[], platform: string = process.platform): Response {
  const path = mediaPath(request.url, platform);
  if (!path || !roots.some((root) => isInside(root, path))) return new Response("Forbidden", { status: 403 });
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) return new Response("Not found", { status: 404 });
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    // "bytes=100-", "bytes=100-199" or the last N bytes "bytes=-500"
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(stream(path, start, end), {
      status: 206,
      headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  }
  return new Response(stream(path, 0, Math.max(0, size - 1)), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}

function stream(path: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
}

export { MEDIA_SCHEME };
