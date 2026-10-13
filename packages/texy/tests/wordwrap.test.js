/**
 * wordwrap() conformance against a PHP-generated differential corpus
 * (tools/wordwrap-oracle.php), plus targeted behaviors.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wordwrap } from "../src/wordwrap.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const corpus = JSON.parse(readFileSync(join(root, "tests", "fixtures", "wordwrap-corpus.json"), "utf8"));

describe("wordwrap matches the PHP reference", () => {
  it(`replays the ${corpus.length}-case differential corpus`, () => {
    for (const c of corpus) {
      assert.strictEqual(
        wordwrap(c.input, c.width, c.break),
        c.expected,
        `input=${JSON.stringify(c.input)} width=${c.width} break=${JSON.stringify(c.break)}`,
      );
    }
  });
});

describe("wordwrap semantics", () => {
  it("breaks at the last space of an over-long line, consuming it", () => {
    assert.strictEqual(wordwrap("aaa bbb ccc ddd", 5, "\n"), "aaa\nbbb\nccc\nddd");
    assert.strictEqual(wordwrap("aa   bb cc", 5, "|"), "aa  |bb cc");
  });

  it("does not cut words longer than the width", () => {
    assert.strictEqual(wordwrap("aaaaaa bb", 5, "\n"), "aaaaaa\nbb");
  });

  it("emits the break even when nothing follows it (trailing space)", () => {
    assert.strictEqual(wordwrap("aaaaa ", 5, "\n"), "aaaaa\n");
  });

  it("counts bytes, not characters (breaks can fire mid-character)", () => {
    assert.strictEqual(wordwrap("a á bbbb c", 3, "|"), "a|á|bbbb|c");
  });

  it("breaks at spaces only - tabs and newlines are not break points", () => {
    assert.strictEqual(wordwrap("tab\tseparated\ttext with words", 5, "|"), "tab\tseparated\ttext|with|words");
  });

  it("returns the empty string unchanged", () => {
    assert.strictEqual(wordwrap("", 5, "\n"), "");
  });
});
