/**
 * defTexy: the declarative configuration facade - spreadable presets
 * (...Configuration.safe applies safeMode as the base), the allowed
 * list/array forms, the policy/htmlOutput sections and per-module
 * sections. Unknown section names throw.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Configuration, defTexy, Syntax } from "../index.js";
import { Configurator } from "../src/Configurator.js";
import { None } from "../src/HtmlPolicy.js";
import { Texy } from "../src/Texy.js";

/** The Texy 3 comment setup, imperatively - the parity oracle. */
function commentTexy() {
  const texy = new Texy();
  Configurator.safeMode(texy);
  texy.allowed[Syntax.Inserted] = true;
  texy.allowed[Syntax.Deleted] = true;
  texy.allowed[Syntax.Superscript] = true;
  texy.allowed[Syntax.Subscript] = true;
  texy.htmlPolicy.allowedTags = false;
  texy.headingModule.top = 4;
  return texy;
}

/** The same comment setup, declaratively. */
function declaredTexy() {
  return defTexy({
    ...Configuration.safe,
    allowed: [Syntax.Inserted, Syntax.Deleted, Syntax.Subscript, Syntax.Superscript],
    htmlPolicy: { allowedTags: false },
    headingModule: { top: 4 },
  });
}

describe("defTexy declarative configuration", () => {
  it("reproduces the imperative comment setup on the hostile corpus", () => {
    const input = '++ins++ --del-- sup^2 sub_2_ "nice" .[btn]\n\n<script>alert(1)</script> x\n\nTitle\n=====\n\nsee "comment":[1] and "other":[2]';
    const imperative = commentTexy();
    const declared = declaredTexy();
    imperative.linkModule.addDefinition("1", "https://example.com/comment-1#comment");
    imperative.linkModule.addDefinition("2", "https://example.com/comment-3#comment");
    declared.linkModule.addDefinition("1", "https://example.com/comment-1#comment");
    declared.linkModule.addDefinition("2", "https://example.com/comment-3#comment");

    assert.strictEqual(declared.process(input), imperative.process(input));
  });

  it("the spread preset keeps safe mode under the user's overrides", () => {
    const texy = declaredTexy();

    // safe mode survives: only allowedTags was overridden, by name
    assert.strictEqual(texy.htmlPolicy.allowedClasses, None);
    assert.strictEqual(texy.htmlPolicy.allowedStyles, None);
    assert.strictEqual(texy.htmlPolicy.allowedTags, false);
    assert.strictEqual(texy.urlPolicy.linkPattern, String.raw`~https?:|ftp:|mailto:~A`);
    assert.strictEqual(texy.urlPolicy.imagePattern, String.raw`~https?:~A`);
    assert.strictEqual(texy.htmlOutput.linkNoFollow, true);

    // the allowed array is additive, it does not replace the preset's disables
    assert.strictEqual(texy.allowed[Syntax.Image], false);
    assert.strictEqual(texy.allowed[Syntax.Figure], false);
    assert.strictEqual(texy.allowed[Syntax.ImageDefinition], false);
    assert.strictEqual(texy.allowed[Syntax.LinkDefinition], false);
    assert.strictEqual(texy.allowed[Syntax.HtmlComment], false);
    assert.strictEqual(texy.allowed[Syntax.Inserted], true);
    assert.strictEqual(texy.allowed[Syntax.Deleted], true);
    assert.strictEqual(texy.allowed[Syntax.Superscript], true);
    assert.strictEqual(texy.allowed[Syntax.Subscript], true);

    assert.strictEqual(texy.headingModule.top, 4);
  });

  it("enables the ins/del/sup/sub phrases and escapes tags", () => {
    assert.strictEqual(
      declaredTexy().process("++x++ --y-- a^2 b_2_"),
      "<p><ins>x</ins> <del>y</del> a<sup>2</sup> b<sub>2</sub>_</p>\n",
    );
    assert.strictEqual(declaredTexy().process("Title\n===="), "<h4>Title</h4>\n");
  });

  it("allowed as a map sets explicit switches", () => {
    const texy = defTexy({ allowed: { [Syntax.Typography]: false, [Syntax.Hyphenation]: false } });
    assert.strictEqual(texy.allowed[Syntax.Typography], false);
    assert.strictEqual(texy.allowed[Syntax.Hyphenation], false);
    assert.strictEqual(texy.process('"nice"'), '<p>"nice"</p>\n');
  });

  it("htmlOutput and urlPolicy sections configure the instance", () => {
    const texy = defTexy({
      htmlOutput: { indent: false },
      urlPolicy: { linkPattern: String.raw`~https?:~A` },
    });
    assert.strictEqual(texy.htmlOutput.indent, false);
    assert.strictEqual(texy.urlPolicy.linkPattern, String.raw`~https?:~A`);
  });

  it("unknown section names throw", () => {
    assert.throws(() => defTexy({ nopeModule: {} }), /Unknown defTexy\(\) configuration section: nopeModule/);
    assert.throws(() => defTexy({ engine: {} }), /Unknown defTexy\(\) configuration section: engine/);
  });

  it("without configuration it behaves like new Texy()", () => {
    const expected = "<p>Hello <strong>world</strong></p>\n";
    assert.strictEqual(defTexy().process("Hello **world**"), expected);
    assert.strictEqual(defTexy({}).process("Hello **world**"), expected);
    assert.strictEqual(new Texy().process("Hello **world**"), expected);
  });
});
