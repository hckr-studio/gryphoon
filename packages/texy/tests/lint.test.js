/**
 * Lint collection (src/Lint.js): the parse-time observer records what the
 * forgiving passes repair or discard, with source ranges (UTF-16 code-unit
 * offsets into the normalized source, like every AST range), and never
 * changes parse output.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Texy } from "../src/Texy.js";
import { Configurator } from "../src/Configurator.js";
import { Severity } from "../src/Lint.js";
import { normalize } from "../src/normalize.js";
import { dump } from "./helpers/ast-dumper.js";

/** Issues of one lint() run as comparable rows: [code, offset, length, severity]. */
function lintRows(texy, text) {
  return texy.lint(text).issues.map(i => [
    i.code,
    i.range?.offset ?? null,
    i.range?.length ?? null,
    i.severity,
  ]);
}

/** A safeMode-configured Texy (restrictive tag/attribute whitelist). */
function safeTexy() {
  const texy = new Texy();
  Configurator.safeMode(texy);
  return texy;
}

describe("lint: html pairing", () => {
  it("unclosed opening tag is reported at its source range", () => {
    assert.deepEqual(lintRows(new Texy(), "<b>bold"), [
      ["html/tag-unclosed", 0, 3, Severity.Warning],
    ]);
  });

  it("stray closing tag is reported at its source range", () => {
    assert.deepEqual(lintRows(new Texy(), "text</b>"), [
      ["html/tag-stray", 4, 4, Severity.Warning],
    ]);
  });

  it("crossed tags report the crossing and the stray close, without re-reporting the crossed tag as unclosed", () => {
    assert.deepEqual(lintRows(new Texy(), "<b><i>x</b></i>"), [
      ["html/tag-crossed", 3, 3, Severity.Warning],
      ["html/tag-stray", 11, 4, Severity.Warning],
    ]);
  });

  it("well-formed passthrough html reports nothing", () => {
    assert.deepEqual(lintRows(new Texy(), "<em>a</em> and <b>bold</b>"), []);
  });

  it("ranges inside stripped block content are absolute (blockquote prefix)", () => {
    // the "> " prefix is stripped before recursive parsing; OffsetMap rewrites
    // the local <b> position back to source offset 2
    assert.deepEqual(lintRows(new Texy(), "> <b>text"), [
      ["html/tag-unclosed", 2, 3, Severity.Warning],
    ]);
  });
});

describe("lint: html sanitize policy", () => {
  it("element rejected by the whitelist is reported at its opening tag", () => {
    // HtmlElementNode ranges span the opening tag, like everywhere in the AST
    assert.deepEqual(lintRows(safeTexy(), "<script>alert(1)</script>"), [
      ["html/tag-rejected", 0, 8, Severity.Warning],
    ]);
  });

  it("standalone tag rejected by the whitelist is reported alongside the pairing issue", () => {
    assert.deepEqual(lintRows(safeTexy(), "text <script>"), [
      ["html/tag-unclosed", 5, 8, Severity.Warning],
      ["html/tag-rejected", 5, 8, Severity.Warning],
    ]);
  });

  it("attribute dropped by the whitelist is reported as information at the opening tag", () => {
    assert.deepEqual(lintRows(safeTexy(), '<b onclick="x">bold</b>'), [
      ["html/attr-dropped", 0, 15, Severity.Information],
    ]);
  });

  it("tag with whitelisted attribute reports nothing", () => {
    assert.deepEqual(lintRows(safeTexy(), '<b title="t">bold</b>'), []);
  });
});

describe("lint: references", () => {
  it("undefined link reference is reported over the whole link", () => {
    assert.deepEqual(lintRows(new Texy(), '"click":[nowhere]'), [
      ["link/reference-undefined", 0, 17, Severity.Warning],
    ]);
  });

  it("undefined image reference is reported over the whole link", () => {
    assert.deepEqual(lintRows(new Texy(), '"look":[*photo*]'), [
      ["image/reference-undefined", 0, 16, Severity.Warning],
    ]);
  });

  it("defined reference reports nothing", () => {
    const text = '[home]: https://example.org\n\n"click":[home]';
    assert.deepEqual(lintRows(new Texy(), text), []);
  });

  it("direct URL targets are not reported as undefined references", () => {
    assert.deepEqual(lintRows(new Texy(), '"App":[https://developer.chrome.com/blog/app-shell]'), []);
    assert.deepEqual(lintRows(new Texy(), '"site":[www.example.com]'), []);
    assert.deepEqual(lintRows(new Texy(), '"page":[/relative/path]'), []);
    assert.deepEqual(lintRows(new Texy(), '"jump":[#anchor]'), []);
    assert.deepEqual(lintRows(new Texy(), '"search":[?q=keyword]'), []);
    assert.deepEqual(lintRows(new Texy(), '"mail":[someone@example.com]'), []);
  });

  it("a direct image path is not reported as an undefined image reference", () => {
    assert.deepEqual(lintRows(new Texy(), '"look":[*img/photo.png*]'), []);
    assert.deepEqual(lintRows(new Texy(), '"look":[*./i.png*]'), []);
  });

  it("the reported real-world case stays clean", () => {
    const text =
      "Používáme vzor \"Application Shell\":[https://developer.chrome.com/blog/app-shell], kdy hlavní script zavádí jednotlivé\n" +
      "moduly dynamicky, podle aktuální potřeby.";
    assert.deepEqual(lintRows(new Texy(), text), []);
  });
});

describe("lint: passivity", () => {
  it("a collector never changes the parse output", () => {
    const texy = new Texy();
    const inputs = [
      "<b><i>x</b></i>",
      '"click":[nowhere]',
      "> <b>text\n\nsecond paragraph .(note)",
    ];
    for (const text of inputs) {
      const plain = dump(texy.parse(text), text);
      const { document, issues } = texy.lint(text);
      assert.ok(issues.length > 0, `expected issues for ${JSON.stringify(text)}`);
      assert.equal(dump(document, text), plain, `AST changed for ${JSON.stringify(text)}`);
    }
  });

  it("issue ranges stay within the normalized source over the source corpus", () => {
    // the same corpus the conformance tests parse, vendored from dg/texy
    const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sources");
    for (const name of readdirSync(dir)) {
      const text = normalize(readFileSync(join(dir, name), "utf8"));
      const { issues } = new Texy().lint(text);
      for (const issue of issues) {
        assert.ok(issue.range === null || (issue.range.offset >= 0 && issue.range.offset + issue.range.length <= text.length), `${name}: range out of bounds`);
      }
    }
  });

  it("clean document reports nothing", () => {
    assert.deepEqual(lintRows(new Texy(), "Hello **world**."), []);
  });
});
