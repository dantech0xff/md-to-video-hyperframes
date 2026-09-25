/**
 * The publish kit (youtube.md) as sections the user copies one by one: each
 * "## heading" starts a section; a "**Label:** text" line (the older style)
 * is a section too. The "# title" line is not part of any section.
 */
export interface KitSection {
  label: string;
  text: string;
}

export function parsePublishKit(markdown: string): KitSection[] {
  const sections: KitSection[] = [];
  let current: KitSection | undefined;
  const flush = () => {
    if (current) {
      current.text = current.text.replace(/^\n+|\s+$/g, "");
      if (current.text) sections.push(current);
    }
    current = undefined;
  };
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const labelled = /^\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(line);
    if (heading) {
      flush();
      current = { label: heading[1], text: "" };
    } else if (/^#\s/.test(line)) {
      flush();
    } else if (labelled && (!current || current.text.trim() === "" || /^\*\*/.test(line))) {
      flush();
      current = { label: labelled[1].trim(), text: labelled[2] };
    } else if (current) {
      current.text += `${current.text ? "\n" : ""}${line}`;
    }
  }
  flush();
  return sections;
}
