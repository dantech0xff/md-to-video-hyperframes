/**
 * `Get Frames --smoke-test`: checks a build without a user or an agent login.
 * CI runs it against the packaged app on macOS and Windows:
 *   1. the engine host starts, loads the engine and answers
 *   2. the window loads and its bridge reaches the main process
 *   3. a web page, including text added by JavaScript, becomes Markdown
 *   4. the Claude Code ACP adapter starts from inside the app
 * Prints a JSON report; the exit code says whether everything passed.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BrowserWindow } from "electron";
import { adapterEntry, launcherScript } from "./agents/claude-code";
import type { EngineClient } from "./engine";
import { run } from "./locate";
import type { PageFetcher } from "./sources";

const ARTICLE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Kotlin Flow cơ bản | Blog</title></head>
<body>
<nav><a href="/">Trang chủ</a> <a href="/about">Giới thiệu</a></nav>
<article>
<h1>Kotlin Flow cơ bản</h1>
<p>Flow là một luồng dữ liệu bất đồng bộ trong Kotlin Coroutines. Nó phát ra nhiều giá trị theo thời gian,
khác với suspend function chỉ trả về một giá trị. Bài này giải thích cách tạo flow, cách thu thập giá trị
và những toán tử hay dùng nhất khi làm ứng dụng Android.</p>
<pre><code class="language-kotlin">val numbers = flow {
    for (i in 1..3) emit(i)
}</code></pre>
<p>Khi gọi collect, flow mới bắt đầu chạy: đây là luồng lạnh. Mỗi lần collect là một lần chạy lại từ đầu.
Nhờ vậy ta có thể tạo flow ở bất kỳ đâu mà không tốn tài nguyên cho tới khi thật sự cần.</p>
</article>
<footer>Bản quyền 2026</footer>
<script>document.querySelector("article").insertAdjacentHTML("beforeend", "<p>Đoạn này do JavaScript thêm vào sau khi trang tải xong.</p>");</script>
</body></html>`;

export interface SmokeContext {
  engine: EngineClient;
  createWindow: () => BrowserWindow;
  fetchPage: PageFetcher;
}

export async function runSmokeTest(ctx: SmokeContext): Promise<number> {
  const report: Record<string, unknown> = {};
  try {
    // 1. engine host
    const info = await ctx.engine.ensure();
    report.engine = info;
    const catalog = await ctx.engine.call("catalog", undefined);
    if (!catalog.styles.length) throw new Error("the engine lists no style packs");
    report.styles = catalog.styles.map((s) => s.id);

    // 2. window and bridge
    const win = ctx.createWindow();
    await new Promise<void>((resolve, reject) => {
      win.webContents.once("did-finish-load", () => resolve());
      win.webContents.once("did-fail-load", (_e, code, description) => reject(new Error(`the window did not load: ${description} (${code})`)));
    });
    report.bridge = await win.webContents.executeJavaScript(`window.getFrames.invoke("app:info").then((i) => i.version)`);
    let rendered = 0;
    for (let i = 0; i < 50 && rendered === 0; i++) {
      rendered = (await win.webContents.executeJavaScript(`(document.getElementById("root")?.innerText ?? "").length`)) as number;
      if (!rendered) await new Promise((r) => setTimeout(r, 100));
    }
    if (!rendered) throw new Error("the window shows nothing");
    report.rendered = rendered;

    // 3. web page to Markdown
    const server = createServer((_req, res) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(ARTICLE));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const page = await ctx.fetchPage(`http://127.0.0.1:${(server.address() as AddressInfo).port}/kotlin-flow`);
      if (page.type !== "article") throw new Error(`the test page came back as a ${page.type}`);
      for (const needle of ["```kotlin", "emit(i)", "JavaScript thêm vào"]) {
        if (!page.markdown.includes(needle)) throw new Error(`the article Markdown lacks "${needle}":\n${page.markdown}`);
      }
      report.article = page.title;
    } finally {
      server.close();
    }

    // 4. ACP adapter
    const adapter = await run(process.execPath, [launcherScript(), adapterEntry(), "--version"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeoutMs: 30_000,
    });
    if (adapter.code !== 0) throw new Error(`the ACP adapter did not start: ${adapter.stderr}`);
    report.adapter = adapter.stdout.trim();

    console.log(JSON.stringify({ ok: true, ...report }, null, 2));
    return 0;
  } catch (e) {
    console.error(JSON.stringify({ ok: false, ...report, error: (e as Error).stack ?? String(e) }, null, 2));
    return 1;
  }
}
