import { describe, it, expect, vi, beforeEach } from "vitest";
import { request } from "node:http";

type Guard = (details: { url: string }, callback: (response: { cancel?: boolean }) => void) => void;

// the download session is Electron's: here its fetch is whatever each test gives, and its request filter is kept to call
const net = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
  guard: undefined as Guard | undefined,
  dns: {} as Record<string, { address: string; family: number }[]>,
  /** what the network's own settings say for a URL */
  systemProxy: "DIRECT",
  /** what the download session was told, in order */
  steps: [] as unknown[],
}));
vi.mock("electron", () => ({
  session: {
    defaultSession: { resolveProxy: async () => net.systemProxy },
    fromPartition: () => ({
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined,
      on: () => undefined,
      setUserAgent: () => undefined,
      setProxy: async (config: unknown) => void net.steps.push({ proxy: config }),
      closeAllConnections: async () => void net.steps.push("close connections"),
      clearStorageData: async () => void net.steps.push("clear storage"),
      webRequest: { onBeforeRequest: (guard: Guard) => (net.guard = guard) },
      fetch: (url: string, init: RequestInit) => {
        net.steps.push(`fetch ${url}`);
        return net.fetch(url, init);
      },
    }),
  },
  BrowserWindow: class {},
}));
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    if (!net.dns[host]) throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    return net.dns[host];
  },
}));
net.dns["router.lan"] = [{ address: "192.168.1.1", family: 4 }];
net.dns["example.com"] = [{ address: "93.184.215.14", family: 4 }];

import { documentName, fetchPage, isPrivateHost } from "./web-page";

/** What the session's request filter says about a request. */
const allowed = (url: string) => new Promise<boolean>((resolve) => net.guard!({ url }, (r) => resolve(!r.cancel)));

/** A body that sends one chunk and then nothing, ever. */
const stalled = () => new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new Uint8Array([37, 80, 68, 70])) });

describe("fetchPage", () => {
  // a block body: a function returned from beforeEach would run as the test's cleanup
  beforeEach(() => {
    net.fetch.mockReset();
  });

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

  it("refuses what says it is too big before reading it", async () => {
    const big = String(30 * 1024 * 1024);
    net.fetch.mockResolvedValue(new Response("<html></html>", { headers: { "content-type": "text/html", "content-length": big } }));
    await expect(fetchPage("https://example.com/huge-page")).rejects.toThrow(/quá lớn/);
    net.fetch.mockResolvedValue(new Response("%PDF", { headers: { "content-type": "application/pdf", "content-length": big } }));
    await expect(fetchPage("https://example.com/huge.pdf")).rejects.toThrow(/quá lớn/);
  });

  it("only downloads http(s) links, and reports server and network errors", async () => {
    await expect(fetchPage("file:///etc/passwd")).rejects.toThrow(/http\(s\)/);
    expect(net.fetch).not.toHaveBeenCalled();
    net.fetch.mockResolvedValue(new Response("gone", { status: 404 }));
    await expect(fetchPage("https://example.com/missing")).rejects.toThrow("máy chủ trả về 404");
    net.fetch.mockRejectedValue(new Error("net::ERR_NAME_NOT_RESOLVED"));
    await expect(fetchPage("https://no-such-host.example/")).rejects.toThrow("net::ERR_NAME_NOT_RESOLVED");
  });

  it("keeps a link from the internet away from this machine and the local network", async () => {
    net.fetch.mockResolvedValue(new Response("notes", { headers: { "content-type": "text/plain" } }));
    await fetchPage("https://example.com/notes.txt");
    // every request of the session passes the filter: the link, its redirects, what the page loads
    expect(await allowed("https://example.com/image.png")).toBe(true);
    expect(await allowed("http://127.0.0.1:8080/admin")).toBe(false);
    expect(await allowed("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(await allowed("http://[::1]:3000/")).toBe(false);
    expect(await allowed("http://router.lan/status")).toBe(false);
    // no files or app URLs either; a page's own inline data is fine
    expect(await allowed("file:///Users/dan/.ssh/id_rsa")).toBe(false);
    expect(await allowed("gf-media://local/Users/dan/Movies/x.mp4")).toBe(false);
    expect(await allowed("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(await allowed("blob:https://example.com/5f1c")).toBe(true);
    // stopped by the filter: the user is told why
    net.fetch.mockRejectedValue(new Error("net::ERR_BLOCKED_BY_CLIENT"));
    await expect(fetchPage("https://example.com/redirects-home")).rejects.toThrow(/mạng nội bộ/);
  });

  it("fetches a local address the user typed, only while that download runs", async () => {
    let during: boolean[] = [];
    net.fetch.mockImplementation(async () => {
      during = [await allowed("http://127.0.0.1:3000/docs/next"), await allowed("http://10.0.0.5/")];
      return new Response("# Docs", { headers: { "content-type": "text/markdown" } });
    });
    expect(await fetchPage("http://127.0.0.1:3000/docs/guide.md")).toMatchObject({ type: "file", name: "guide.md" });
    expect(during).toEqual([true, false]);
    expect(await allowed("http://127.0.0.1:3000/docs/next")).toBe(false);
  });
});

describe("the download session", () => {
  beforeEach(() => {
    net.fetch.mockReset();
    net.steps = [];
    net.systemProxy = "DIRECT";
  });

  it("connects through a proxy of its own, which checks each address it connects to, and is gone after", async () => {
    let proxied: Promise<number> | undefined;
    net.fetch.mockImplementation(async () => {
      // the proxy is up while the download runs: it answers a plain request for a private address with 403
      const { proxyRules } = (net.steps[0] as { proxy: { proxyRules: string } }).proxy;
      proxied = fetchThrough(proxyRules, "http://127.0.0.1:9/");
      await proxied;
      return new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } });
    });
    await fetchPage("https://example.com/files/flow.pdf");
    expect(await proxied).toBe(403);
    const config = (net.steps[0] as { proxy: { proxyRules: string; proxyBypassRules: string } }).proxy;
    expect(config.proxyRules).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // localhost too: Chromium would skip the proxy for it otherwise
    expect(config.proxyBypassRules).toBe("<-loopback>");
    expect(net.steps.slice(1)).toEqual(["close connections", "fetch https://example.com/files/flow.pdf", "clear storage"]);
    await expect(fetchThrough(config.proxyRules, "http://example.com/")).rejects.toThrow(/ECONNREFUSED/);
  });

  it("keeps a network's own proxy, which looks the names up itself", async () => {
    net.systemProxy = "PROXY proxy.corp.example:8080";
    net.fetch.mockResolvedValue(new Response("notes", { headers: { "content-type": "text/plain" } }));
    await fetchPage("https://example.com/notes.txt");
    expect(net.steps[0]).toEqual({ proxy: { mode: "system" } });
  });

  it("clears cookies and storage after every download, a document's too", async () => {
    net.fetch.mockResolvedValue(new Response("gone", { status: 404 }));
    await expect(fetchPage("https://example.com/missing.pdf")).rejects.toThrow("404");
    net.fetch.mockResolvedValue(new Response("%PDF-1.7", { headers: { "content-type": "application/pdf", "set-cookie": "id=42" } }));
    await fetchPage("https://example.com/flow.pdf");
    expect(net.steps.filter((s) => s === "clear storage")).toHaveLength(2);
    expect(net.steps.at(-1)).toBe("clear storage");
  });
});

/** Status of a plain http request sent to the proxy in `proxyRules`. */
function fetchThrough(proxyRules: string, url: string): Promise<number> {
  const { hostname, port } = new URL(proxyRules);
  return new Promise((resolve, reject) => {
    // a new connection each time, as a browser opening one after the proxy closed
    const req = request({ host: hostname, port, path: url, headers: { host: new URL(url).host }, agent: false }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("downloads at the same time", () => {
  beforeEach(() => {
    net.fetch.mockReset();
  });

  it("run one after another, so a local address typed for one is never open to another", async () => {
    const steps: string[] = [];
    let release: (() => void) | undefined;
    net.fetch.mockImplementation(async (url) => {
      steps.push(`start ${url}`);
      if (url.includes("127.0.0.1")) await new Promise<void>((r) => (release = r));
      else steps.push(`local open to it: ${await allowed("http://127.0.0.1:3000/secret")}`);
      return new Response("notes", { headers: { "content-type": "text/plain" } });
    });
    const local = fetchPage("http://127.0.0.1:3000/notes.txt");
    const remote = fetchPage("https://example.com/notes.txt");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await new Promise((r) => setTimeout(r, 50));
    expect(steps).toEqual(["start http://127.0.0.1:3000/notes.txt"]);
    release!();
    await Promise.all([local, remote]);
    expect(steps).toEqual(["start http://127.0.0.1:3000/notes.txt", "start https://example.com/notes.txt", "local open to it: false"]);
  });
});

describe("isPrivateHost", () => {
  it("knows this machine, private networks and the names that lead there", async () => {
    for (const host of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.1.1", "0.0.0.0", "[::1]", "::", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "router.lan"]) {
      expect(await isPrivateHost(host), host).toBe(true);
    }
    for (const host of ["8.8.8.8", "93.184.215.14", "2606:4700::1111", "example.com", "no-such-host.example"]) {
      expect(await isPrivateHost(host), host).toBe(false);
    }
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
