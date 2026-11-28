import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  _buildCodeBlockHtml,
  COPY_LABEL,
  ICON_CHEVRON,
} from "../public/src/shared/markdown.js";
import { MARKDOWN_CSS } from "../public/src/shared/markdown-css.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const markdownCss = read("../public/src/styles/markdown.css");

test("code block copy button is labelled Copy", () => {
  assert.equal(COPY_LABEL, "Copy");
  const html = _buildCodeBlockHtml("python", "python", "print(1)", "print(1)");
  assert.match(html, /<span class="copy-label">Copy<\/span>/);
});

test("code block download button is icon-only and keeps the file-name tooltip", () => {
  const html = _buildCodeBlockHtml("python", "python", "print(1)", "print(1)");
  assert.doesNotMatch(html, /download-label/);
  assert.match(html, /class="code-download-btn"[^>]*data-filename="[^"]+"[^>]*title="[^"]+"/s);
});

test("collapse button carries both glyphs and the language name stays next to it", () => {
  assert.match(ICON_CHEVRON, /cb-ic-collapse/);
  assert.match(ICON_CHEVRON, /cb-ic-expand/);
  const html = _buildCodeBlockHtml("cpp", "cpp", "int x;", "int x;");
  assert.ok(html.indexOf("code-collapse-btn") < html.indexOf("code-lang-label"));
  assert.doesNotMatch(html, />\s*Collapse\s*</);
});

for (const [name, css] of [["markdown.css", markdownCss], ["MARKDOWN_CSS", MARKDOWN_CSS]]) {
  test(`${name}: quotes use the Telegram style`, () => {
    const rule = css.match(/\.md-blockquote\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.match(rule, /border-radius:\s*7px/);
    assert.match(rule, /rgba\(75,\s*160,\s*45,\s*0\.14\)/);
    assert.match(rule, /border-inline-start:\s*3\.5px solid #4ba02d/);
    assert.match(rule, /padding-inline:\s*1rem 2rem/);
    assert.doesNotMatch(rule, /border-right|border-left/);
    const icon = css.match(/\.md-blockquote::after\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.match(icon, /content:\s*"\u201d"/);
    assert.match(icon, /inset-inline-end:\s*0\.55rem/);
    assert.match(icon, /top:\s*0\.25rem/);
    assert.match(icon, /rgba\(75,\s*160,\s*45,\s*0\.75\)/);
  });

  test(`${name}: header buttons outweigh host button resets`, () => {
    assert.match(css, /\.code-block-wrapper > button\.copy-code-btn[\s\S]*?min-height:\s*0/);
    assert.match(css, /button\.copy-code-btn:hover:not\(:disabled\)/);
  });

  test(`${name}: mixed-direction list items reserve their own marker indent`, () => {
    assert.match(
      css,
      /:where\(\.md-list\[dir="ltr"\] > li\[dir="rtl"\], \.md-list\[dir="rtl"\] > li\[dir="ltr"\]\)\s*\{\s*margin-inline-start:\s*1\.4em/
    );
  });
}
