/**
 * Tests for Modifier parsing - ported from the modifier semantics documented
 * in docs/porting.md §2.3 and exercised by the reference modifier.phpt.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Modifier } from "../src/Modifier.js";

describe("Modifier", () => {
  it("parses title", () => {
    const m = Modifier.parse("(title)");
    assert.equal(m.title, "title");
    assert.equal(m.classes.id, undefined);
  });

  it("unescapes \\) inside the title", () => {
    const m = Modifier.parse("(hello \\) world)");
    assert.equal(m.title, "hello ) world");
  });

  it("decodes entities in the title", () => {
    const m = Modifier.parse("(caf&eacute;)");
    assert.equal(m.title, "café");
  });

  it("parses classes and id, last id wins", () => {
    const m = Modifier.parse("[class1 class2 #id1 #id2]");
    assert.deepEqual(Object.keys(m.classes), ["class1", "class2"]);
    assert.equal(m.id, "id2");
  });

  it("parses styles and attributes", () => {
    const m = Modifier.parse("{color: red; text-align: center}");
    assert.deepEqual(m.styles, { color: "red", "text-align": "center" });
  });

  it("known attribute names become attrs, not styles", () => {
    const m = Modifier.parse("{color: red; title: tip; data-x: 1; aria-label: y; width: 10px}");
    assert.deepEqual(m.styles, { color: "red", width: "10px" }); // width stays a style
    assert.deepEqual(m.attrs, { title: "tip", "data-x": "1", "aria-label": "y" });
  });

  it("RDFa property becomes an attr, not a style", () => {
    const m = Modifier.parse("{property: dc:title; color: red}");
    assert.deepEqual(m.attrs, { property: "dc:title" });
    assert.deepEqual(m.styles, { color: "red" });
  });

  it("all RDFa attributes become attrs, not styles", () => {
    const m = Modifier.parse(
      "{about: https://example.com/; datatype: rdf:HTML; prefix: dc: http://purl.org/dc/terms/; property: dc:title; resource: #book; typeof: Book; vocab: https://schema.org/; color: red}",
    );
    assert.deepEqual(m.attrs, {
      about: "https://example.com/",
      datatype: "rdf:HTML",
      prefix: "dc: http://purl.org/dc/terms/",
      property: "dc:title",
      resource: "#book",
      typeof: "Book",
      vocab: "https://schema.org/",
    });
    assert.deepEqual(m.styles, { color: "red" });
  });

  it("parses alignments", () => {
    assert.equal(Modifier.parse("<").hAlign, "left");
    assert.equal(Modifier.parse(">").hAlign, "right");
    assert.equal(Modifier.parse("=").hAlign, "justify");
    assert.equal(Modifier.parse("<>").hAlign, "center");
    assert.equal(Modifier.parse("^").vAlign, "top");
    assert.equal(Modifier.parse("-").vAlign, "middle");
    assert.equal(Modifier.parse("_").vAlign, "bottom");
  });

  it("parts combine in any order", () => {
    const m = Modifier.parse("<>^[cls]{color: blue}(title)");
    assert.equal(m.hAlign, "center");
    assert.equal(m.vAlign, "top");
    assert.equal(m.title, "title");
    assert.ok(m.classes.cls);
    assert.equal(m.styles.color, "blue");
  });

  it("null for null input", () => {
    assert.equal(Modifier.parse(null), null);
  });

  it("tracks the source range", () => {
    const m = Modifier.parse("(title)[c]", 42);
    assert.equal(m.range.offset, 42);
    assert.equal(m.range.length, 10);
  });
});
