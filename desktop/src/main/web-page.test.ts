import { describe, it, expect, vi, beforeEach } from "vitest";

// the download session is Electron's; here its fetch is whatever each test gives
const net = vi.hoisted(() => ({ fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>() }));
vi.mock("electron", () => ({
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined,
      on: () => undefined,
      setUserAgent: () => undefined,
      clearStorageData: async () => undefined,
      fetch: (url: string, init: RequestInit) => net.fetch(url, init),
    }),
  },
  BrowserWindow: class {},
}));

import { documentName, fetchPage } from "./web-page";

/** A body that sends one chunk and then nothing, ever. */
const stalled = () => new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new Uint8Array([37, 80, 68, 70])) });

describe("fetchPage", () => {
  beforeEach(() => net.fetch.mockReset());

  it("saves documents as they are", async () => {
    net.fetch.mockResolvedValue(new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
    const page = await fetchPage("https://example.com/files/flow.pdf");
    expect(page).toMatchObject({ type: "file", url: "https://example.com/files/flow.pdf", name: "flow.pdf" });
    expect(page.type === "file" && page.data.toString()).toBe("%PDF-1.7");
  });

  it("gives up on a server that does not answer, or stops sending", async () => {
    // a fetch that never settles, even if it ignores the abort signal
    net.fetch.mockReturnValue(new Promise<Response>(() => undefined));
    await expect(fetchPage("https://slow.example.com/", 150)).rejects.toThrow("trang tải quá lâu");
    net.fetch.mockResolvedValue(new Response(stalled(), { headers: { "content-type": "application/pdf" } }));
    await expect(fetchPage("https://slow.example.com/big.pdf", 150)).rejects.toThrow("trang tải quá lâu");
    // the request itself was told to stop
    expect(net.fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it("only downloads http(s) links, and reports server errors", async () => {
    await expect(fetchPage("file:///etc/passwd")).rejects.toThrow(/http\(s\)/);
    expect(net.fetch).not.toHaveBeenCalled();
    net.fetch.mockResolvedValue(new Response("gone", { status: 404 }));
    await expect(fetchPage("https://example.com/missing")).rejects.toThrow("máy chủ trả về 404");
  });
});

describe("documentName", () => {
  it("names PDFs and text files after the link, and leaves HTML to the article reader", () => {
    expect(documentName("application/pdf", "https://example.com/a/b/Kotlin%20Flow")).toBe("Kotlin-Flow.pdf");
    expect(documentName("text/markdown", "https://example.com/README")).toBe("README.md");
    expect(documentName("text/plain", "https://example.com/notes.txt")).toBe("notes.txt");
    expect(documentName("text/html", "https://example.com/post")).toBeUndefined();
  });
});
