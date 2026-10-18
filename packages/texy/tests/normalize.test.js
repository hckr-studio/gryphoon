/**
 * Tests for normalize() - ported from tests/Texy/normalize.phpt.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalize, normalizeWithMap } from "../src/normalize.js";

describe("normalize()", () => {
  it("line endings are converted to \\n", () => {
    assert.equal(normalize("a\r\nb\rc"), "a\nb\nc");
  });

  it("leading byte order mark is removed", () => {
    assert.equal(normalize("\uFEFFtext"), "text");
    assert.equal(normalize("\n\uFEFF\ntext"), "text"); // surfaces after the blank-line trim
    assert.equal(normalize("te\uFEFFxt"), "te\uFEFFxt"); // only the leading one
  });

  it("control characters are removed, tabs stay", () => {
    assert.equal(normalize("a\x00\x08\x0B\x1Fb"), "ab");
    assert.equal(normalize("a\tb"), "a\tb");
  });

  it("soft hyphens are preserved", () => {
    assert.equal(normalize("wo\u00ADrd"), "wo\u00ADrd");
  });

  it("lines are right-trimmed", () => {
    assert.equal(normalize("a  \t\nb\t"), "a\nb");
  });

  it("blank edge lines are dropped", () => {
    assert.equal(normalize("\n\n  \ntext\n \n\n"), "text");
  });

  it("idempotence", () => {
    const dirty = "\uFEFF\r\n first\u00AD line  \r\nsecond\tline \x07\n\n";
    const clean = normalize(dirty);
    assert.equal(normalize(clean), clean);
  });

  it("invalid UTF-8 is rejected", () => {
    assert.throws(() => normalize("valid \uD83D invalid"), /not valid UTF-8/); // lone high surrogate
  });
});

describe("normalizeWithMap()", () => {
  const cases = [
    "",
    "plain text",
    "a\r\nb\rc",
    "\uFEFFtext",
    "\n\uFEFF\ntext",
    "a\x00\x08\x0B\x1Fb",
    "a  \t\nb\t",
    "\n\n  \ntext\n \n\n",
    "\uFEFF\r\n first\u00AD line  \r\nsecond\tline \x07\n\n",
    "\r\n\r\n<b>bold",
    "\n\n<b>bold",
  ];

  it("produces exactly what normalize() produces (the corpus included)", () => {
    const corpus = readdirSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sources"));
    for (const text of [...cases, ...corpus.map(name => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sources", name), "utf8"))]) {
      assert.equal(normalizeWithMap(text).text, normalize(text));
    }
  });

  it("map is monotonic, in bounds, and anchored at kept characters", () => {
    for (const text of cases) {
      const { text: clean, map } = normalizeWithMap(text);
      for (let i = 0; i < clean.length; i++) {
        assert.ok(map[i] <= map[i + 1], `map must be monotonic at ${i} for ${JSON.stringify(text)}`);
        assert.ok(map[i] < text.length, `map must stay in bounds at ${i} for ${JSON.stringify(text)}`);
        // each kept unit still matches, modulo the CRLF collapse
        assert.ok(text[map[i]] === clean[i] || (clean[i] === "\n" && text[map[i]] === "\r"), `anchor mismatch at ${i} for ${JSON.stringify(text)}`);
      }
    }
  });

  it("maps offsets across a collapsed CRLF pair", () => {
    const { text, map } = normalizeWithMap("para\r\n\r\n<b>");
    assert.equal(text, "para\n\n<b>");
    assert.equal(map[6], 8); // normalized <b> offset 6 -> original offset 8 (after two \r\n)
  });

  it("maps offsets across stripped leading blank lines", () => {
    const { text, map } = normalizeWithMap("\n\n<b>");
    assert.equal(text, "<b>");
    assert.equal(map[0], 2);
  });
});
