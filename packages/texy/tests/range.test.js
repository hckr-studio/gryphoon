/**
 * Range tracking for AST nodes - ported from tests/Texy/range.phpt (the unit
 * tests; the position-*.texy matrix is covered by the conformance suite).
 *
 * All ranges are UTF-16 code-unit offsets; source extraction by
 * src.slice(offset, offset + length) must return the construct's source.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Texy } from "../src/Texy.js";
import { normalize } from "../src/normalize.js";
import { findFirst } from "../src/NodeHelpers.js";
import { PhraseNode, TextNode } from "../src/nodes.js";

function parse(text) {
  return new Texy().parse(normalize(text));
}

/** Extracts the source text of the first node of a class with a range. */
function extractBySource(doc, src, nodeClass) {
  const node = findFirst(doc, n => n instanceof nodeClass && n.range !== null);
  return node === null ? null : src.slice(node.range.offset, node.range.length + node.range.offset);
}

describe("range tracking", () => {
  it("positions inside list item with blank line between continuation lines", () => {
    const src = normalize("- první řádek\n\n  pokračování **tučné**");
    const doc = parse(src);
    assert.equal(extractBySource(doc, src, PhraseNode), "**tučné**");
  });

  it("positions inside multiline table cell (rowspan)", () => {
    const src = normalize("| první **tučný** | x\n| pokračování ^| y");
    const doc = parse(src);
    assert.equal(extractBySource(doc, src, PhraseNode), "**tučný**");
  });

  it("positions inside div block with indented content", () => {
    const src = normalize("/--div\n  odstavec **tučný**\n\\--");
    const doc = parse(src);
    assert.equal(extractBySource(doc, src, PhraseNode), "**tučný**");
  });

  it("paragraph line merging and modifier keep exact inline ranges", () => {
    const src = "prvni radek\n   pokracovani **tucne** dal\ndalsi text .[trida]";
    const doc = parse(src);
    const para = doc.content.children[0];

    assert.equal(Object.keys(para.modifier.classes)[0], "trida");

    const check = node => {
      for (const child of node.getChildren()) check(child);
      if (node instanceof PhraseNode && node.range !== null) {
        assert.equal(src.slice(node.range.offset, node.range.offset + node.range.length), "**tucne**");
      }
    };
    check(para);

    // text node after the hard break must point at its source position
    let found = false;
    const walk = node => {
      for (const child of node.getChildren()) walk(child);
      if (node instanceof TextNode && node.text.startsWith("pokracovani")) {
        found = true;
        assert.equal(src.slice(node.range.offset, node.range.offset + 12), "pokracovani ");
      }
    };
    walk(para);
    assert.ok(found);
  });
});
