/**
 * linkedom DOM projection (renderDom): the rendered tree exposed as a
 * real DOM for transformation before serialization.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Texy } from "../src/Texy.js";

describe("renderDom", () => {
  it("projects the rendered content into a linkedom <body>", () => {
    const texy = new Texy();
    const dom = texy.renderDom(texy.parse("Hello **world**"));
    assert.strictEqual(dom.body.innerHTML, "<p>Hello <strong>world</strong></p>");
  });

  it("escapes text nodes at serialization", () => {
    const texy = new Texy();
    const dom = texy.renderDom(texy.parse("a < b & c"));
    assert.strictEqual(dom.body.textContent, "a < b & c");
    assert.strictEqual(dom.body.innerHTML, "<p>a &lt; b &amp; c</p>");
  });

  it("splices Raw fragments as real nodes", () => {
    const texy = new Texy();
    const dom = texy.renderDom(texy.parse("Prvni <!-- note --> after"));
    const comment = dom.body.firstElementChild.childNodes[1];
    assert.strictEqual(comment.nodeType, 8); // Comment node
    assert.strictEqual(comment.data, " note ");
  });

  it("supports DOM transformation, then linkedom serialization", () => {
    const texy = new Texy();
    const dom = texy.renderDom(texy.parse("paragraph\n\n- one\n- two"));
    const ul = dom.body.querySelector("ul");
    ul.classList.add("styled");
    ul.lastElementChild.remove();
    dom.body.firstElementChild.setAttribute("data-page", "1");
    assert.strictEqual(dom.body.innerHTML, '<p data-page="1">paragraph</p><ul class="styled"><li>one</li></ul>');
  });

  it("serializes composite class/style attributes joined like formatAttrs", () => {
    const texy = new Texy();
    const dom = texy.renderDom(texy.parse("text .[a b]{color:red}\n"));
    const p = dom.body.querySelector("p");
    assert.strictEqual(p.getAttribute("class"), "a b");
    assert.strictEqual(p.getAttribute("style"), "color:red");
  });

  it("never appends children to void elements", () => {
    const texy = new Texy();
    const dom = texy.renderDom(texy.parse("[* img.jpg *]"));
    const img = dom.body.querySelector("img");
    assert.strictEqual(img.childNodes.length, 0);
    assert.strictEqual(img.outerHTML, '<img alt="" src="images/img.jpg">');
  });
});
