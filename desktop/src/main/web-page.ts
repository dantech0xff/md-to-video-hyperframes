/**
 * Downloads a web page for sources/ (design doc task 1.5). Articles open in a
 * hidden, sandboxed Chromium window, so pages rendered by JavaScript work too;
 * Readability picks the main content and Turndown turns it into Markdown,
 * both run in an isolated world the page's own scripts cannot reach. PDFs and
 * plain text are saved as they are. A page from the internet cannot lead the
 * download to this machine or the local network.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { BrowserWindow, session, type Session } from "electron";
import readabilitySource from "@mozilla/readability/Readability.js?raw";
import turndownSource from "turndown/lib/turndown.browser.umd.js?raw";
import type { Fetched } from "./sources";

const MAX_BYTES = 25 * 1024 * 1024;
const TOO_BIG = "file quá lớn (tối đa 25 MB)";
const WORLD_ID = 1001;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

/** Runs in the page's isolated world, after Readability and Turndown are defined there. */
const EXTRACT = `(() => {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.remove(["script", "style", "noscript", "iframe", "form", "button"]);
  // code blocks keep their language (class="language-kotlin", "lang-js", "highlight-source-ts")
  td.addRule("code-block", {
    filter: (node) => node.nodeName === "PRE",
    replacement: (_content, node) => {
      const code = node.querySelector("code") || node;
      const cls = (code.className || "") + " " + (node.className || "");
      const lang = (/(?:language|lang|highlight-source)-([\\w+#.-]+)/.exec(cls) || [])[1] || "";
      const text = (code.textContent || "").replace(/\\n+$/, "");
      return "\\n\\n\`\`\`" + lang + "\\n" + text + "\\n\`\`\`\\n\\n";
    },
  });
  const article = new Readability(document.cloneNode(true), { charThreshold: 300, keepClasses: true }).parse();
  const html = article && article.content ? article.content : document.body ? document.body.innerHTML : "";
  return {
    url: location.href,
    title: (article && article.title) || document.title || "",
    byline: (article && article.byline) || undefined,
    siteName: (article && article.siteName) || undefined,
    markdown: td.turndown(html),
  };
})()`;

/** This machine, private networks and other addresses no page from the internet should reach. */
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  PRIVATE.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(net, bits, "ipv6");
}

type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;

/** The host is, or resolves to, a private address (one that cannot be resolved is not). */
export async function isPrivateHost(host: string, resolve: Resolve = (h) => lookup(h, { all: true })): Promise<boolean> {
  const bare = host.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  const addresses = family ? [{ address: bare, family }] : await resolve(bare).catch(() => []);
  return addresses.some((a) => PRIVATE.check(a.address, a.family === 6 ? "ipv6" : "ipv4"));
}

/** Private hosts the user typed, while their download runs: the only private addresses a download may reach. */
const typedHosts = new Set<string>();
/** recent answers of isPrivateHost: a page asks for many files on the same few hosts */
const verdicts = new Map<string, { at: number; private: Promise<boolean> }>();

function privateHost(host: string): Promise<boolean> {
  const known = verdicts.get(host);
  if (known && Date.now() - known.at < 60_000) return known.private;
  if (verdicts.size > 500) verdicts.clear();
  const verdict = isPrivateHost(host);
  verdicts.set(host, { at: Date.now(), private: verdict });
  return verdict;
}

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * Every request of a download (the link, its redirects, what the page loads):
 * the web, with private addresses only when the user typed them, and the
 * page's own inline data; no files, no app URLs, nothing else.
 */
async function mayRequest(url: string): Promise<boolean> {
  if (/^(data|blob|about):/i.test(url)) return true;
  if (!/^(https?|wss?):/i.test(url)) return false;
  const host = hostOf(url);
  return typedHosts.has(host) || !(await privateHost(host));
}

let fetchSession: Session | undefined;

/** One in-memory session for downloads: no cookies of the user's, no permissions, no file downloads. */
function pageSession(): Session {
  if (fetchSession) return fetchSession;
  const ses = session.fromPartition("getframes-fetch", { cache: false });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  ses.setUserAgent(USER_AGENT);
  ses.webRequest.onBeforeRequest((details, callback) => {
    mayRequest(details.url).then(
      (ok) => callback({ cancel: !ok }),
      () => callback({ cancel: true }),
    );
  });
  fetchSession = ses;
  return ses;
}

/** Downloads run one at a time: a local address the user typed is open to its own download only. */
let downloads: Promise<unknown> = Promise.resolve();

/** Downloads `url` (http or https) within `timeoutMs` of its turn, whatever the server does. */
export async function fetchPage(url: string, timeoutMs = 45_000): Promise<Fetched> {
  if (!isWeb(url)) throw new Error("chỉ tải được link http(s)");
  const run = downloads.then(() => download(url, timeoutMs));
  downloads = run.catch(() => undefined);
  return run;
}

async function download(url: string, timeoutMs: number): Promise<Fetched> {
  const ses = pageSession();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("trang tải quá lâu")), timeoutMs);
  const started = Date.now();
  const host = hostOf(url);
  let typed = false;
  try {
    // a link the user typed to this machine or the local network is theirs to fetch (their own docs server…)
    typed = await abortable(privateHost(host), deadline.signal);
    if (typed) typedHosts.add(host);
    // what is behind the link: a document is saved as it is, anything else is read as an article
    const res = await abortable(ses.fetch(url, { redirect: "follow", headers: { "User-Agent": USER_AGENT }, signal: deadline.signal }), deadline.signal);
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      throw new Error(`máy chủ trả về ${res.status}`);
    }
    // a page or document that says it is too big is not loaded at all
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
      void res.body?.cancel().catch(() => undefined);
      throw new Error(TOO_BIG);
    }
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const doc = documentName(type, res.url || url);
    if (doc) {
      const data = await readLimited(res, deadline.signal);
      return { type: "file", url: res.url || url, name: doc, data };
    }
    void res.body?.cancel().catch(() => undefined);
    return await abortable(readArticle(res.url || url, ses, timeoutMs - (Date.now() - started)), deadline.signal);
  } catch (e) {
    // the session's request filter stopped it
    if (/ERR_BLOCKED_BY_CLIENT/.test((e as Error).message)) throw new Error("link dẫn tới một địa chỉ trong máy hoặc mạng nội bộ; app chỉ tải địa chỉ đó khi bạn nhập thẳng link của nó");
    throw e;
  } finally {
    clearTimeout(timer);
    if (typed) typedHosts.delete(host);
  }
}

async function readArticle(url: string, ses: Session, timeoutMs: number): Promise<Fetched> {
  // no preload: nothing of the app's bridge in this window, and its session is not the app's
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1000,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webgl: false, spellcheck: false, backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // the page stays on the web: no file:, data: or app URLs, even by redirect
  const stayOnWeb = (event: Electron.Event, target: string) => {
    if (!isWeb(target)) event.preventDefault();
  };
  win.webContents.on("will-navigate", stayOnWeb);
  win.webContents.on("will-redirect", stayOnWeb);
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async () => {
      await win.loadURL(url);
      await settle(win);
      return (await win.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [
        { code: `${readabilitySource}\n;\n${turndownSource}\n;\n${EXTRACT}` },
      ])) as Omit<Extract<Fetched, { type: "article" }>, "type">;
    })();
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("trang tải quá lâu")), Math.max(timeoutMs, 0))));
    // a page too heavy for its renderer (which runs apart from the app) fails at once, not at the deadline
    const gone = new Promise<never>((_, reject) => {
      win.webContents.once("render-process-gone", (_e, details) => reject(new Error(`trình duyệt dừng khi mở trang (${details.reason})`)));
    });
    gone.catch(() => undefined); // it may also come as the window closes, after the result
    const page = await Promise.race([work, timeout, gone]);
    if (!page.markdown.trim()) throw new Error("không đọc được nội dung chính của trang");
    if (Buffer.byteLength(page.markdown) > MAX_BYTES) throw new Error(TOO_BIG);
    return { type: "article", ...page };
  } finally {
    clearTimeout(timer);
    win.destroy();
    // cleared before the next download starts
    await ses.clearStorageData().catch(() => undefined);
  }
}

function isWeb(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** `work`, or the signal's reason once it aborts: a stalled server cannot hold the caller. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Waits until the page's text stops growing (content rendered by JavaScript), at most ~8 s. */
async function settle(win: BrowserWindow): Promise<void> {
  let last = -1;
  for (let i = 0; i < 16; i++) {
    const length = (await win.webContents.executeJavaScript("document.body ? document.body.innerText.length : 0").catch(() => 0)) as number;
    if (length > 0 && length === last) return;
    last = length;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** A file name for documents saved as they are; undefined for HTML. */
export function documentName(contentType: string, url: string): string | undefined {
  const path = new URL(url).pathname;
  const base = decodeURIComponent(path.split("/").pop() || "").replace(/[^\w.-]+/g, "-") || "document";
  if (contentType === "application/pdf") return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  if (contentType === "text/markdown" || contentType === "text/x-markdown") return /\.(md|markdown)$/i.test(base) ? base : `${base}.md`;
  if (contentType === "text/plain") return /\.(md|markdown|txt)$/i.test(base) ? base : `${base}.txt`;
  return undefined;
}

async function readLimited(res: Response, signal: AbortSignal): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error(TOO_BIG);
      chunks.push(value);
    }
  } catch (e) {
    void reader.cancel().catch(() => undefined);
    throw e;
  }
  return Buffer.concat(chunks);
}
