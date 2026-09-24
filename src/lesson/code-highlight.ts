/** Syntax highlighting with Shiki (VS Code grammars) → per-line HTML spans. */
import { createHighlighter, type Highlighter, bundledLanguages } from "shiki";
import { esc } from "./markup.js";

let highlighter: Highlighter | null = null;
const loadedThemes = new Set<string>();
const loadedLangs = new Set<string>();

const LANG_ALIAS: Record<string, string> = {
  kt: "kotlin", kts: "kotlin", js: "javascript", ts: "typescript", sh: "bash", shell: "bash",
  zsh: "bash", yml: "yaml", gradle: "groovy", objc: "objective-c", md: "markdown", text: "text", txt: "text",
};

export interface HighlightedCode {
  lines: string[];
  fg: string;
  bg: string;
}

export async function highlightCode(code: string, lang: string, theme: string): Promise<HighlightedCode> {
  const l = LANG_ALIAS[lang.toLowerCase()] ?? lang.toLowerCase();
  const langId = l in bundledLanguages ? l : "text";
  if (!highlighter) highlighter = await createHighlighter({ themes: [theme], langs: langId === "text" ? [] : [langId] });
  if (!loadedThemes.has(theme)) {
    await highlighter.loadTheme(theme as Parameters<Highlighter["loadTheme"]>[0]);
    loadedThemes.add(theme);
  }
  if (langId !== "text" && !loadedLangs.has(langId)) {
    await highlighter.loadLanguage(langId as Parameters<Highlighter["loadLanguage"]>[0]);
    loadedLangs.add(langId);
  }
  const src = code.replace(/\t/g, "    ").replace(/\s+$/g, "");
  const res = highlighter.codeToTokensBase(src, { lang: langId as never, theme: theme as never });
  const t = highlighter.getTheme(theme as never);
  const lines = res.map((tokens) =>
    tokens
      .map((tok) => {
        const style: string[] = [];
        if (tok.color) style.push(`color:${tok.color}`);
        if (tok.fontStyle && tok.fontStyle & 1) style.push("font-style:italic");
        if (tok.fontStyle && tok.fontStyle & 2) style.push("font-weight:600");
        return `<span style="${style.join(";")}">${esc(tok.content)}</span>`;
      })
      .join(""),
  );
  return { lines, fg: t.fg, bg: t.bg };
}

/** Simple LCS line diff for the `diff` scene. */
export function lineDiff(before: string[], after: string[]): { kind: "ctx" | "del" | "add"; text: string }[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { kind: "ctx" | "del" | "add"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: "ctx", text: before[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: "del", text: before[i++] });
    else out.push({ kind: "add", text: after[j++] });
  }
  while (i < n) out.push({ kind: "del", text: before[i++] });
  while (j < m) out.push({ kind: "add", text: after[j++] });
  return out;
}
