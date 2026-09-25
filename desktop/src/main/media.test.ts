import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaPath, mediaUrl } from "../shared/media";
import { serveMedia } from "./media";

describe("media URLs", () => {
  it("round-trips macOS and Windows paths", () => {
    const mac = "/Users/dan/Movies/Get Frames/2026-09-25-kotlin/landscape/storyboard/shot-001.png";
    expect(mediaUrl(mac)).toBe("gf-media://local/Users/dan/Movies/Get%20Frames/2026-09-25-kotlin/landscape/storyboard/shot-001.png");
    expect(mediaPath(mediaUrl(mac), "darwin")).toBe(mac);
    const win = "C:\\Users\\dan\\Videos\\Get Frames\\a#1\\video.mp4";
    expect(mediaUrl(win)).toBe("gf-media://local/C:/Users/dan/Videos/Get%20Frames/a%231/video.mp4");
    expect(mediaPath(mediaUrl(win), "win32")).toBe(win);
    expect(mediaUrl(mac, 1700000000)).toMatch(/\?v=1700000000$/);
    expect(mediaPath("https://example.com/x.png", "darwin")).toBeUndefined();
  });
});

describe("serveMedia", () => {
  it("serves files inside the allowed folders, with byte ranges for seeking", async () => {
    const root = await mkdtemp(join(tmpdir(), "media-"));
    const file = join(root, "video.mp4");
    await writeFile(file, "0123456789");
    const get = (url: string, range?: string) => serveMedia(new Request(url, { headers: range ? { range } : {} }), [root]);

    const full = get(mediaUrl(file));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(await full.text()).toBe("0123456789");

    const part = get(mediaUrl(file), "bytes=2-5");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");

    expect(await get(mediaUrl(file), "bytes=7-").text()).toBe("789");
    expect(await get(mediaUrl(file), "bytes=-3").text()).toBe("789");
    expect(get(mediaUrl(file), "bytes=20-").status).toBe(416);
  });

  it("refuses files outside the allowed folders and missing ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "media-"));
    const other = await mkdtemp(join(tmpdir(), "other-"));
    await writeFile(join(other, "secret.txt"), "x");
    const get = (path: string) => serveMedia(new Request(mediaUrl(path)), [root]);
    expect(get(join(other, "secret.txt")).status).toBe(403);
    expect(get(join(root, "..", other.split(/[\\/]/).pop()!, "secret.txt")).status).toBe(403);
    expect(get(join(root, "missing.png")).status).toBe(404);
    expect(get(root).status).toBe(404);
  });
});
