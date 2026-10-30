export class JiraMarkdownDocument {
  private inline(text: string): unknown[] {
    const nodes: unknown[] = [];
    const pattern = /\\([\\`*_[\]<>#])|\*\*([^*]+)\*\*|`([^`]+)`/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index! > offset)
        nodes.push({ type: "text", text: text.slice(offset, match.index) });
      if (match[1]) nodes.push({ type: "text", text: match[1] });
      else
        nodes.push({
          type: "text",
          text: match[2] ?? match[3],
          marks: [{ type: match[2] ? "strong" : "code" }],
        });
      offset = match.index! + match[0].length;
    }
    if (offset < text.length)
      nodes.push({ type: "text", text: text.slice(offset) });
    return nodes;
  }
  render(markdown: string): unknown {
    const content: Record<string, unknown>[] = [];
    let list: Record<string, unknown> | undefined;
    for (const line of markdown.split("\n")) {
      if (!line.trim()) {
        list = undefined;
        continue;
      }
      const heading = /^(#{1,6}) (.*)$/.exec(line);
      if (heading) {
        content.push({
          type: "heading",
          attrs: { level: heading[1]!.length },
          content: this.inline(heading[2]!),
        });
        list = undefined;
        continue;
      }
      const item = /^(?:- |(\d+)\. )(.*)$/.exec(line);
      if (item) {
        const type = item[1] ? "orderedList" : "bulletList";
        if (!list || list.type !== type) {
          list = {
            type,
            content: [],
            ...(item[1] ? { attrs: { order: Number(item[1]) } } : {}),
          };
          content.push(list);
        }
        (list.content as unknown[]).push({
          type: "listItem",
          content: [{ type: "paragraph", content: this.inline(item[2]!) }],
        });
        continue;
      }
      list = undefined;
      content.push({ type: "paragraph", content: this.inline(line) });
    }
    return { type: "doc", version: 1, content };
  }
}
