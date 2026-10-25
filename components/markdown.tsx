import { markdownToTelegramHtml } from "@/lib/telegram/format";

/**
 * Agent replies as HTML for the web: the same safe conversion Telegram uses (everything escaped;
 * only bold, code, http(s) links), plus headings, bullet lists and *italics*. Code blocks are left as is.
 */
export function markdownToWebHtml(markdown: string): string {
  let inPre = false;
  return markdownToTelegramHtml(markdown)
    .split("\n")
    .map((line) => {
      const opens = line.includes("<pre");
      const closes = line.includes("</pre>");
      if (inPre || opens) {
        inPre = (inPre || opens) && !closes;
        return line;
      }
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (heading) return `<strong class="md-heading">${heading[1]}</strong>`;
      const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
      const text = bullet ? `${bullet[1]}• ${bullet[2]}` : line;
      return text.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, "$1<i>$2</i>");
    })
    .join("\n");
}

export function Markdown({ text }: { text: string }) {
  return <div className="md whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: markdownToWebHtml(text) }} />;
}
