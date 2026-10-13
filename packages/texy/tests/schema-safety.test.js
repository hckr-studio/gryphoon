/**
 * Schema lookup-key safety: tag and attribute names are user-controlled
 * (literal HTML in the input), so every lookup table is a Map - a
 * plain-object lookup with a key like 'constructor' would return an
 * inherited Object.prototype member instead of a miss. These regression
 * tests pin that contract; refactoring a table back to a plain object
 * fails here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Texy } from "../src/Texy.js";
import { urlAttribute, inlineElements, voidElements, isKnown, hasOptionalEnd } from "../src/Output/Html/Schema.js";

describe("Schema keys are user-controlled", () => {
  it("urlAttribute misses on Object.prototype property names", () => {
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      assert.strictEqual(urlAttribute(name), null, name);
    }
    // and still hits real URL attributes
    assert.strictEqual(urlAttribute("href"), "link");
    assert.strictEqual(urlAttribute("src"), "image");
  });

  it("inline element classification misses on prototype property names", () => {
    for (const name of ["constructor", "toString", "valueOf"]) {
      assert.strictEqual(inlineElements.get(name) ?? null, null, name);
      assert.strictEqual(voidElements.has(name), false, name);
    }
    // known elements still classify
    assert.strictEqual(inlineElements.get("span"), 0);
    assert.strictEqual(voidElements.has("br"), true);
  });

  it("known-element checks miss on prototype property names", () => {
    assert.strictEqual(isKnown("constructor"), false);
    assert.strictEqual(hasOptionalEnd("toString"), false);
  });

  it("a literal element named like a prototype property escapes as text, not markup", () => {
    const t = new Texy();
    const out = t.process("x <constructor>y</constructor> z");
    assert.ok(!out.includes("<constructor>"), "the unknown element must not pass through as markup");
    assert.ok(out.includes("&lt;constructor&gt;"), `expected escaped element, got: ${JSON.stringify(out)}`);
  });
});
