import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createHttpServer, request, type Server } from "node:http";
import { connect, createServer, type AddressInfo } from "node:net";
import { startGuardProxy, type GuardProxy } from "./guard-proxy";

// every name leads to this machine; which answers count as private is up to each test
const dns: Record<string, string[]> = {
  "blog.example": ["127.0.0.1"],
  "docs.lan": ["127.0.0.1"],
  // a public answer and a private one: the name may not be trusted with either
  "mixed.example": ["127.0.0.1", "10.0.0.7"],
};
const privateAddresses = new Set(["10.0.0.7"]);
const typedHosts = new Set<string>();

let web: Server;
let echo: ReturnType<typeof createServer>;
let proxy: GuardProxy;
const port = (s: { address(): AddressInfo | string | null }) => (s.address() as AddressInfo).port;

beforeAll(async () => {
  web = createHttpServer((req, res) => res.end(`${req.method} ${req.url} for ${req.headers.host}`));
  echo = createServer((s) => s.pipe(s));
  await Promise.all([new Promise<void>((r) => web.listen(0, "127.0.0.1", r)), new Promise<void>((r) => echo.listen(0, "127.0.0.1", r))]);
  proxy = await startGuardProxy({
    resolve: async (host) => (dns[host] ?? []).map((address) => ({ address, family: 4 })),
    isPrivate: (address) => privateAddresses.has(address),
    typed: (host) => typedHosts.has(host),
  });
});

afterAll(async () => {
  await proxy.close();
  web.close();
  echo.close();
});

/** A plain http request through the proxy, as the browser sends it. */
function viaProxy(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: proxy.port, path: url, headers: { host: new URL(url).host }, agent: false }, (res) => {
      let body = "";
      res.on("data", (d: Buffer) => (body += d.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** A tunnel through the proxy (https, WebSockets): its answer, and what comes back through it. */
function tunnel(authority: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxy.port, "127.0.0.1", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    let seen = "";
    socket.on("data", (d: Buffer) => {
      seen += d.toString();
      if (seen.startsWith("HTTP/1.1 200") && seen.endsWith("\r\n\r\n")) socket.write("ping");
      if (seen.endsWith("ping")) socket.end();
    });
    socket.on("end", () => resolve(seen));
    socket.on("error", reject);
  });
}

describe("guard proxy", () => {
  it("forwards a page from the web to the address it looked up, with the page's own host name", async () => {
    const url = `http://blog.example:${port(web)}/posts/flow?x=1`;
    expect(await viaProxy(url)).toEqual({ status: 200, body: `GET /posts/flow?x=1 for blog.example:${port(web)}` });
  });

  it("tunnels https to the address it looked up", async () => {
    const answer = await tunnel(`blog.example:${port(echo)}`);
    expect(answer).toMatch(/^HTTP\/1\.1 200 /);
    expect(answer.endsWith("ping")).toBe(true);
  });

  it("refuses a name with a private answer, even next to a public one, whatever the browser would have got", async () => {
    expect((await viaProxy(`http://mixed.example:${port(web)}/`)).status).toBe(403);
    expect(await tunnel(`mixed.example:${port(echo)}`)).toMatch(/^HTTP\/1\.1 403 /);
    // and one that has no address
    expect((await viaProxy(`http://nowhere.example/`)).status).toBe(403);
  });

  it("reaches a private host only while the user's own link to it downloads", async () => {
    privateAddresses.add("127.0.0.1");
    try {
      expect((await viaProxy(`http://docs.lan:${port(web)}/guide`)).status).toBe(403);
      expect(await tunnel(`127.0.0.1:${port(echo)}`)).toMatch(/^HTTP\/1\.1 403 /);
      typedHosts.add("docs.lan");
      expect(await viaProxy(`http://docs.lan:${port(web)}/guide`)).toEqual({ status: 200, body: `GET /guide for docs.lan:${port(web)}` });
    } finally {
      typedHosts.clear();
      privateAddresses.delete("127.0.0.1");
    }
  });

  it("stops answering once closed", async () => {
    const other = await startGuardProxy({ resolve: async () => [], isPrivate: () => false, typed: () => false });
    await other.close();
    await expect(
      new Promise((resolve, reject) => {
        const socket = connect(other.port, "127.0.0.1", () => resolve(socket.end()));
        socket.on("error", reject);
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
