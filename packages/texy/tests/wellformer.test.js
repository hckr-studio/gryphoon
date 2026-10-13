/**
 * WellFormer unit tests. Expected outputs generated with the reference
 * implementation (tools/wellformer-probe.php) over hand-built render
 * trees - the same trees are rebuilt here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WellFormer } from "../src/Output/Html/WellFormer.js";
import { Element } from "../src/Output/Html/Element.js";
import { Raw } from "../src/Output/Html/Raw.js";
import { Config } from "../src/Output/Html/Config.js";

/**
 * @param {Element|Raw|string} child
 * @param {Config} config
 */
function render(child, config = new Config()) {
  const wellFormer = new WellFormer(config);
  wellFormer.feed(child);
  return wellFormer.finish();
}

describe("WellFormer", () => {
  it("indents a simple paragraph", () => {
    const p = new Element("p");
    p.setText("Hello");
    assert.strictEqual(render(p), "\n<p>Hello</p>\n");
  });

  it("shrinks runs of spaces and newlines in normal text", () => {
    const p = new Element("p");
    p.setText("a  b \n\n c");
    assert.strictEqual(render(p), "\n<p>a b c</p>\n");
  });

  it("keeps empty inline elements inline", () => {
    const p = new Element("p");
    p.add("a ").add(new Element("strong")).add("b");
    assert.strictEqual(render(p), "\n<p>a <strong></strong>b</p>\n");
  });

  it("auto-closes optional-end paragraphs", () => {
    const d = new Element("div");
    d.create("p").setText("one");
    d.create("p").setText("two");
    assert.strictEqual(render(d), "\n<div>\n\t<p>one</p>\n\n\t<p>two</p>\n</div>\n");
  });

  it("treats unknown tags as transparent wrappers inheriting the content model", () => {
    const d = new Element("div");
    d.create("my-widget").create("p").setText("in");
    assert.strictEqual(render(d), "\n<div>\n\t<my-widget>\n\t\t<p>in</p>\n\t</my-widget>\n</div>\n");
  });

  it('tokenizes raw HTML: stray "<" stays, comments preserved, <br> eats the trailing space', () => {
    const p = new Element("p");
    p.add(new Raw("a < b &amp; <br> <!-- c --> tail"));
    assert.strictEqual(render(p), "\n<p>a < b &amp;<br>\n<!-- c --> tail</p>\n");
  });

  it("puts non-inline voids on their own lines", () => {
    const d = new Element("div");
    d.create("hr");
    d.create("p").setText("x");
    assert.strictEqual(render(d), "\n<div>\n\t<hr>\n\n\t<p>x</p>\n</div>\n");
  });

  it("allows text inside tables (the content model includes text)", () => {
    const t = new Element("table");
    t.add("stray");
    t.create("tr").create("td").setText("cell");
    assert.strictEqual(render(t), "\n<table>stray\n\t<tr>\n\t\t<td>cell</td>\n\t</tr>\n</table>\n");
  });

  it("drops nested <a> (deep prohibitions)", () => {
    const outer = new Element("a", { href: "x" });
    outer
      .add("in")
      .add(new Element("a", { href: "y" }))
      .add("after");
    assert.strictEqual(render(outer), '<a href="x">inafter</a>');
  });

  it("preserves spaces in pre/code verbatim", () => {
    const pre = new Element("pre");
    pre.create("code").setText("  a   b  ");
    assert.strictEqual(render(pre), "\n<pre><code>  a   b  </code></pre>\n");
  });

  it("ignores closing tags of void elements; <hr> closes the paragraph (content model)", () => {
    const p = new Element("p");
    p.add(new Raw('a</br>b<img src="x"><hr>c'));
    assert.strictEqual(render(p), '\n<p>ab<img src="x"></p>\n\n<hr>\nc');
  });

  it("wraps long lines at the configured width", () => {
    const config = new Config();
    config.lineWrap = 10;
    const p = new Element("p");
    p.setText("aaa bbb ccc ddd eee fff ggg");
    assert.strictEqual(render(p, config), "\n<p>aaa bbb\nccc ddd\neee fff\nggg</p>\n");
  });

  it("does not indent when config.indent is off", () => {
    const config = new Config();
    config.indent = false;
    const d = new Element("div");
    d.create("p").setText("x");
    assert.strictEqual(render(d, config), "<div><p>x</p></div>");
  });

  it("eats spaces after <br> and puts the text on a new line", () => {
    const p = new Element("p");
    p.add("a").add(new Element("br")).add("  b");
    assert.strictEqual(render(p), "\n<p>a<br>\nb</p>\n");
  });

  it("respects baseIndent", () => {
    const config = new Config();
    config.baseIndent = 2;
    const d = new Element("div");
    d.create("p").setText("x");
    assert.strictEqual(render(d, config), "\n\t\t<div>\n\t\t\t<p>x</p>\n\t\t</div>\n");
  });

  it("ignores a stray end tag for an already-closed element (siblings)", () => {
    const p = new Element("p");
    p.add(new Element("strong")).add(new Element("em")).add("x").add(new Raw("</strong>"));
    assert.strictEqual(render(p), "\n<p><strong></strong><em></em>x</p>\n");
  });

  it("closes the paragraph when a block element arrives", () => {
    const d = new Element("div");
    d.create("p").setText("a");
    d.create("blockquote").setText("q");
    assert.strictEqual(render(d), "\n<div>\n\t<p>a</p>\n\n\t<blockquote>q</blockquote>\n</div>\n");
  });
});
