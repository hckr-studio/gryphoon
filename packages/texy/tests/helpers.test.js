/**
 * Tests for entity decoding and string helpers - behavior verified against
 * the reference implementation (PHP html_entity_decode with ENT_QUOTES|ENT_HTML5).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeEntities,
  decodeEntity,
  EntityPattern,
  phpLooseNull,

  stripControlChars,
  toAscii,
  toLower,
  unescapeHtml,
  webalize,
} from "../src/helpers.js";
import { match } from "../src/Regexp.js";

describe("entity decoding", () => {
  it("decodes named references with semicolons", () => {
    assert.equal(unescapeHtml("&amp;"), "&");
    assert.equal(unescapeHtml("&nbsp;"), "\u00A0");
    assert.equal(unescapeHtml("&AMP;"), "&"); // case variants in the table
    assert.equal(unescapeHtml("x &amp; y"), "x & y");
    assert.equal(unescapeHtml("&amp;amp;"), "&amp;"); // single pass only
  });

  it("leaves unknown or semicolonless references literal", () => {
    assert.equal(unescapeHtml("&notanentity;"), "&notanentity;");
    assert.equal(unescapeHtml("&amp"), "&amp");
    assert.equal(unescapeHtml("&Amp;"), "&Amp;");
  });

  it("decodes numeric references per PHP, not per the HTML spec", () => {
    assert.equal(unescapeHtml("&#160;"), "\u00A0");
    assert.equal(unescapeHtml("&#x41;"), "A");
    assert.equal(unescapeHtml("&#x1F600;"), "\u{1F600}");
    assert.equal(unescapeHtml("&#9;"), "\t"); // tab, LF and FF decode
    assert.equal(unescapeHtml("&#10;"), "\n");
    assert.equal(unescapeHtml("&#12;"), "\f");
    assert.equal(unescapeHtml("&#13;"), "&#13;"); // other controls stay literal
    assert.equal(unescapeHtml("&#1;"), "&#1;");
    assert.equal(unescapeHtml("&#127;"), "&#127;");
    assert.equal(unescapeHtml("&#128;"), "&#128;"); // no Windows-1252 remap
    assert.equal(unescapeHtml("&#x80;"), "&#x80;");
    assert.equal(unescapeHtml("&#xD800;"), "&#xD800;"); // surrogates stay literal
  });

  it("decodeEntity returns null for unknown references", () => {
    assert.equal(decodeEntity("&amp;"), "&");
    assert.equal(decodeEntity("&unknown;"), null);
    assert.equal(decodeEntity("&#1;"), null);
    assert.equal(decodeEntity("&#0;"), "\uFFFD"); // NUL -> replacement char
    assert.equal(decodeEntity("&#x0;"), "\uFFFD");
    assert.equal(decodeEntity("&#000;"), "\uFFFD");
  });

  it("decodeEntities strips smuggled control characters", () => {
    assert.equal(decodeEntities("&#9;"), "\t"); // tab survives
    assert.equal(decodeEntities("&#12;"), ""); // FF is stripped after decoding
    assert.equal(decodeEntities("a&#3;b"), "a&#3;b");
    assert.equal(decodeEntities("plain"), "plain");
  });

  it("the entity pattern matches all reference shapes", () => {
    assert.ok(match("&amp;", "~^" + EntityPattern + "$~"));
    assert.ok(match("&#123;", "~^" + EntityPattern + "$~"));
    assert.ok(match("&#xAbC;", "~^" + EntityPattern + "$~"));
    assert.equal(match("&amp", "~^" + EntityPattern + "$~"), null);
  });
});

describe("string helpers", () => {
  it("stripControlChars removes all but CR", () => {
    assert.equal(stripControlChars("a\x00b\x0Bc\x0Cd\x0Ee"), "abcde");
    assert.equal(stripControlChars("a\rb"), "a\rb"); // internal hard-break marker survives
  });

  it("toLower is unicode-aware", () => {
    assert.equal(toLower("ĚŠČŘŽÝÁÍÉ"), "ěščřžýáíé");
    assert.equal(toLower("ABC"), "abc");
  });

  it("toAscii removes accents via Unicode normalization", () => {
    assert.equal(toAscii("Související články"), "Souvisejici clanky");
    assert.equal(toAscii("naïve café"), "naive cafe");
    assert.equal(toAscii("Tiếng Việt"), "Tieng Viet"); // all scripts, not just Latin-1
    assert.equal(toAscii("DÉMON"), "DEMON"); // case preserved
  });

  it("toAscii maps the letters normalization cannot decompose", () => {
    assert.equal(toAscii("Ørsted"), "Orsted");
    assert.equal(toAscii("Straße"), "Strasse");
    assert.equal(toAscii("Ærø"), "Aero");
    assert.equal(toAscii("đurđević"), "durdevic");
    assert.equal(toAscii("łódź"), "lodz");
    assert.equal(toAscii("Þórr"), "Thorr");
    assert.equal(toAscii("Faðir"), "Fadir");
    assert.equal(toAscii("œuvre"), "oeuvre");
  });

  it("webalize converts to [a-z0-9-] slugs (oracle-verified)", () => {
    assert.equal(webalize("Nová zbraň pro boj s duplicitním obsahem"), "nova-zbran-pro-boj-s-duplicitnim-obsahem");
    assert.equal(webalize("Ørstěd"), "orsted");
    assert.equal(webalize("Straße"), "strasse");
  });
});

describe("phpLooseNull (PHP $v == null)", () => {
  it("is true for null, undefined, false, empty string, zero, string zero", () => {
    for (const v of [null, undefined, false, "", 0, "0"]) {
      assert.equal(phpLooseNull(v), true, JSON.stringify(v));
    }
  });

  it("is true for empty arrays only, not non-empty ones", () => {
    assert.equal(phpLooseNull([]), true);
    assert.equal(phpLooseNull(["x"]), false);
    assert.equal(phpLooseNull([0]), false);
  });

  it("is false for anything else", () => {
    for (const v of [true, "x", 1, "00", " ", {}, [null]]) {
      assert.equal(phpLooseNull(v), false, JSON.stringify(v));
    }
  });
});
