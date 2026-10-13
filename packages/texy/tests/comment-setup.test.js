/**
 * The translation of a Texy 3 comment-setup configuration:
 *
 *    Configurator::safeMode, the phrase allowed flags, allowedTags = false,
 *    headingModule->top and linkModule->addReference
 *
 * into this port's APIs. Expected values verified against the PHP
 * reference with the identical configuration. It also pins the
 * parsePhrase fix: the ins/del/sup/sub phrase patterns have no link
 * group, and the port used to treat the missing group as a link
 * (undefined !== null) - enabling these syntaxes crashed before.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Texy } from "../src/Texy.js";
import { Configurator } from "../src/Configurator.js";
import { Syntax } from "../src/Syntax.js";

/**
 * @param {Array<{link?: string}>} references
 */
function commentTexy(references) {
  const texy = new Texy();
  Configurator.safeMode(texy);

  texy.allowed[Syntax.Inserted] = true;
  texy.allowed[Syntax.Superscript] = true;
  texy.allowed[Syntax.Deleted] = true;
  texy.allowed[Syntax.Subscript] = true;
  // Texy 3's 'phrase/cite' has no Texy 4 equivalent: the reference
  // Syntax list dropped it; a custom phrase syntax mapping to <cite>
  // would be the way to reintroduce it.

  texy.htmlPolicy.allowedTags = false;
  texy.headingModule.top = 4;

  references.forEach((comment, index) => {
    if (!("link" in comment)) {
      return; // the name keeps its index, so the numbering has gaps
    }
    // Texy 3: linkModule->addReference(name, new Link(url)) + Link::$label
    // Texy 4: LinkReferenceModule::addDefinition(name, url) - the label
    // carrier is gone (the reference deprecates labels on definitions);
    // the display text lives at the use site ("text":[name]).
    texy.linkModule.addDefinition(String(index + 1), comment.link);
  });

  return texy;
}

describe("Texy 3 comment setup translated", () => {
  it("safe mode: classes and styles drop, tags escape, links get nofollow", () => {
    const texy = commentTexy([
      { link: "https://example.com/comment-1#comment" },
      { comment: "no link here" },
      { link: "https://example.com/comment-3#comment" },
    ]);

    assert.strictEqual(
      texy.process(
        '++ins++ --del-- sup^2 sub_2_ "nice" .[btn]\n\n<script>alert(1)</script> x\n\nTitle\n=====\n\nsee "comment":[1] and "other":[3] and "gap":[2]',
      ),
      "<p><ins>ins</ins> <del>del</del> sup<sup>2</sup> sub<sub>2</sub>_ „nice“</p>\n" +
        "\n" +
        "<p>&lt;script&gt;alert(1)&lt;/scrip­t&gt; x</p>\n" +
        "\n" +
        "<h4>Title</h4>\n" +
        "\n" +
        '<p>see <a href="https://example.com/comment-1#comment"\nrel="nofollow">comment</a> and <a href="https://example.com/comment-3#comment"\nrel="nofollow">other</a> and <a href="2">gap</a></p>\n',
    );
  });

  it("enabled phrases parse without the missing-link-group crash", () => {
    const texy = commentTexy([]);
    // ins/del/sup/sub patterns carry only two groups; before the
    // parsePhrase fix these threw "Cannot read properties of undefined"
    assert.strictEqual(
      texy.process("++x++ --y-- a^2 b_2_"),
      "<p><ins>x</ins> <del>y</del> a<sup>2</sup> b<sub>2</sub>_</p>\n",
    );
  });
});
