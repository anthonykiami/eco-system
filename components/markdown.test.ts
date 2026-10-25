import { describe, expect, it } from "vitest";
import { markdownToWebHtml } from "./markdown";

describe("markdownToWebHtml", () => {
  it("renders headings, bullets, bold and italics, and escapes everything else", () => {
    expect(markdownToWebHtml("## Today\n- **AI**: new *model*\n<script>x</script>")).toBe(
      '<strong class="md-heading">Today</strong>\n• <b>AI</b>: new <i>model</i>\n&lt;script&gt;x&lt;/script&gt;',
    );
  });

  it("leaves code blocks alone and only links http(s)", () => {
    expect(markdownToWebHtml("```\n- not a bullet\n```")).toBe("<pre>- not a bullet</pre>");
    expect(markdownToWebHtml("[x](javascript:alert(1)) [y](https://a.test)")).toBe(
      '[x](javascript:alert(1)) <a href="https://a.test">y</a>',
    );
  });
});
