/**
 * Just enough Markdown for agent messages: paragraphs, lists, code blocks,
 * `code`, **bold** and headings. Built from React elements, never HTML.
 */
import type { ReactNode } from "react";

type Block = { type: "code"; lang: string; text: string } | { type: "list"; ordered: boolean; items: string[] } | { type: "heading"; text: string } | { type: "para"; text: string };

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.join("").trim()) blocks.push({ type: "para", text: para.join("\n").trim() });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```(\S*)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: "code", lang: fence[1], text: code.join("\n") });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", text: heading[1] });
      continue;
    }
    const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = !!item[2];
      const last = blocks.at(-1);
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item[3]);
      else blocks.push({ type: "list", ordered, items: [item[3]] });
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line);
  }
  flush();
  return blocks;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    out.push(token.startsWith("`") ? <code key={m.index}>{token.slice(1, -1)}</code> : <strong key={m.index}>{token.slice(2, -2)}</strong>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseBlocks(text).map((b, i) => {
        if (b.type === "code")
          return (
            <pre key={i}>
              <code>{b.text}</code>
            </pre>
          );
        if (b.type === "heading") return <h4 key={i}>{inline(b.text)}</h4>;
        if (b.type === "list") {
          const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
          return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return (
          <p key={i} className="pre-wrap">
            {inline(b.text)}
          </p>
        );
      })}
    </div>
  );
}
