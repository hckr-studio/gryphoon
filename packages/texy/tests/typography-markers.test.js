/**
 * The bytes TextRunPass marks with cannot be faked by the text of a node
 * (port of tests/Texy/typography-markers.phpt).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ContentNode,
  DocumentNode,
  ImageNode,
  ParagraphNode,
  PhraseNode,
  TextNode,
} from "../src/nodes.js";
import { Syntax } from "../src/Syntax.js";
import { Texy } from "../src/Texy.js";

/**
 * @param {ContentNode} content
 */
function paragraphOf(content) {
  return new DocumentNode(new ContentNode([new ParagraphNode(content)]));
}

describe("typography markers", () => {
  for (const byte of ["\x15", "\x16", "\x17"]) {
    it(`a marker byte (${byte.charCodeAt(0)}) in the text stays where it is and moves nothing`, () => {
      const first = new TextNode(`A${byte}B `);
      const inner = new TextNode("C");
      const last = new TextNode(" D...");
      const document = paragraphOf(
        new ContentNode([first, new PhraseNode(new ContentNode([inner]), Syntax.Strong), last]),
      );

      new Texy().transform(document);

      assert.strictEqual(first.text, `A${byte}B `);
      assert.strictEqual(inner.text, "C");
      assert.strictEqual(last.text, " D\u2026");
    });
  }

  it("all marker bytes at once survive a change of the text", () => {
    const node = new TextNode("\x15a\x16b\x17 ...");
    new Texy().transform(paragraphOf(new ContentNode([node])));

    assert.strictEqual(node.text, "\x15a\x16b\x17 \u2026");
  });

  it("the stand-in characters occurring in the text are not mistaken for marker bytes", () => {
    const node = new TextNode("\uE000\x15\uE001\x16\uE003 ...");
    new Texy().transform(paragraphOf(new ContentNode([node])));

    assert.strictEqual(node.text, "\uE000\x15\uE001\x16\uE003 \u2026");
  });

  it("a marker byte in an alternative text is kept", () => {
    const image = new ImageNode("a.jpg", "x\x17 y...");
    new Texy().transform(paragraphOf(new ContentNode([image])));

    assert.strictEqual(image.alt, "x\x17 y\u2026");
  });
});
