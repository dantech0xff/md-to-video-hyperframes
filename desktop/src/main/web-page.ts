/**
 * Downloads a web page for sources/ (design doc task 1.5). Articles open in a
 * hidden, sandboxed Chromium window, so pages rendered by JavaScript work too;
 * Readability picks the main content and Turndown turns it into Markdown,
 * both run in an isolated world the page's own scripts cannot reach. PDFs and
 * plain text are saved as they are.
 */
import { BrowserWindow, session, type Session } from "electron";
import readabilitySource from "@mozilla/readability/Readability.js?raw";
import turndownSource from "turndown/lib/turndown.browser.umd.js?raw";
import type { Fetched } from "./sources";

const MAX_BYTES = 25 * 1024 * 1024;
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

let fetchSession: Session | undefined;

/** One in-memory session for downloads: no cookies of the user's, no permissions, no file downloads. */
function pageSession(): Session {
  if (fetchSession) return fetchSession;
  const ses = session.fromPartition("getframes-fetch", { cache: false });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  ses.setUserAgent(USER_AGENT);
  fetchSession = ses;
  return ses;
}

/** Downloads `url` (http or https) within `timeoutMs`, whatever the server does. */
export async function fetchPage(url: string, timeoutMs = 45_000): Promise<Fetched> {
  if (!isWeb(url)) throw new Error("chỉ tải được link http(s)");
  const ses = pageSession();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("trang tải quá lâu")), timeoutMs);
  const started = Date.now();
  try {
    // what is behind the link: a document is saved as it is, anything else is read as an article
    const res = await abortable(ses.fetch(url, { redirect: "follow", headers: { "User-Agent": USER_AGENT }, signal: deadline.signal }), deadline.signal);
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      throw new Error(`máy chủ trả về ${res.status}`);
    }
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const doc = documentName(type, res.url || url);
    if (doc) {
      const data = await readLimited(res, deadline.signal);
      return { type: "file", url: res.url || url, name: doc, data };
    }
    void res.body?.cancel().catch(() => undefined);
    return await abortable(readArticle(res.url || url, ses, timeoutMs - (Date.now() - started)), deadline.signal);
  } finally {
    clearTimeout(timer);
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
    const page = await Promise.race([work, timeout]);
    if (!page.markdown.trim()) throw new Error("không đọc được nội dung chính của trang");
    return { type: "article", ...page };
  } finally {
    clearTimeout(timer);
    win.destroy();
    void ses.clearStorageData();
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
      if (size > MAX_BYTES) throw new Error("file quá lớn (tối đa 25 MB)");
      chunks.push(value);
    }
  } catch (e) {
    void reader.cancel().catch(() => undefined);
    throw e;
  }
  return Buffer.concat(chunks);
}
