/**
 * The proxy every connection of a web page download goes through. It looks
 * the host up itself and connects to the address it checked, so the browser
 * never resolves a name: a name that answers the check with a public address
 * and the browser with 127.0.0.1 (DNS rebinding) cannot reach this machine or
 * the local network. It listens on 127.0.0.1 while one download runs.
 */
import type { LookupAddress } from "node:dns";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, isIP, type AddressInfo, type LookupFunction, type Socket } from "node:net";
import type { Duplex } from "node:stream";

export interface GuardOptions {
  /** every address of the host, as dns.lookup(host, { all: true }) gives them */
  resolve(host: string): Promise<{ address: string; family: number }[]>;
  /** an address of this machine or a private network */
  isPrivate(address: string, family: number): boolean;
  /** a private host the user typed: theirs to fetch */
  typed(host: string): boolean;
}

export interface GuardProxy {
  port: number;
  close(): Promise<void>;
}

export async function startGuardProxy(opts: GuardOptions): Promise<GuardProxy> {
  /** where to connect: the host, looked up once and checked; undefined when it may not be reached (or has no address) */
  const destination = async (host: string): Promise<{ host: string; lookup: LookupFunction } | undefined> => {
    const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
    const family = isIP(bare);
    const addresses: LookupAddress[] = family ? [{ address: bare, family }] : await opts.resolve(bare).catch(() => []);
    if (!addresses.length) return undefined;
    if (!opts.typed(bare) && addresses.some((a) => opts.isPrivate(a.address, a.family))) return undefined;
    // the connection tries these addresses, and no other
    const lookup = ((_name: string, options: { all?: boolean }, callback: (err: null, address: string | LookupAddress[], family?: number) => void) =>
      options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)) as LookupFunction;
    return { host: bare, lookup };
  };

  // plain http: the request names its URL in full, and goes to the checked address with its own Host header
  const forward = async (req: IncomingMessage, res: ServerResponse) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      return void res.writeHead(400).end();
    }
    const to = target.protocol === "http:" ? await destination(target.hostname) : undefined;
    if (!to) return void res.writeHead(403).end();
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const port = Number(target.port) || 80;
    const upstream = httpRequest({
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
      createConnection: () => connect({ ...to, port, autoSelectFamily: true }),
    });
    upstream.on("response", (up) => {
      res.writeHead(up.statusCode ?? 502, up.statusMessage, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  };

  // https and WebSockets: a tunnel to the checked address
  const tunnel = async (req: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on("error", () => undefined);
    let target: URL;
    try {
      target = new URL(`http://${req.url ?? ""}`);
    } catch {
      return void client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
    const to = await destination(target.hostname);
    if (!to) return void client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    let open = false;
    const upstream = connect({ ...to, autoSelectFamily: true, port: Number(target.port) || 443 });
    upstream.once("connect", () => {
      open = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => (open ? client.destroy() : client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")));
    client.on("close", () => upstream.destroy());
  };

  const sockets = new Set<Socket>();
  const server = createServer((req, res) => void forward(req, res));
  server.on("connect", (req: IncomingMessage, client: Duplex, head: Buffer) => void tunnel(req, client, head));
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
