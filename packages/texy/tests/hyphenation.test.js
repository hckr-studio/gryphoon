/**
 * Hyphenation (longwords): soft-hyphen syllable breaking, replayed against
 * a PHP-generated corpus (tools/hyphenation-probe.php) plus pipeline
 * integration.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { HyphenationModule } from "../src/Modules/HyphenationModule.js";
import { Syntax } from "../src/Syntax.js";
import { Texy } from "../src/Texy.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const corpus = JSON.parse(readFileSync(join(root, "..", "texy-fixtures", "hyphenation-corpus.json"), "utf8"));

describe("HyphenationModule.postLine matches the reference", () => {
  it(`replays the ${corpus.length}-case corpus (incl. marker bytes, wordLimit variants)`, () => {
    const module = new HyphenationModule({ allowed: {} });
    for (const c of corpus) {
      module.wordLimit = c.wordLimit ?? 20;
      assert.strictEqual(module.postLine(c.input), c.expected, `input=${JSON.stringify(c.input)}`);
    }
  });
});

describe("hyphenation in the pipeline", () => {
  it("breaks long words with soft hyphens", () => {
    const texy = new Texy();
    assert.strictEqual(
      texy.process("slovo nejneobhospodařovávatelnějšími konec"),
      "<p>slovo nejneobhospoda\u00ADřovávatelnější\u00ADmi konec</p>\n",
    );
  });

  it("respects the word limit configuration", () => {
    const texy = new Texy();
    texy.hyphenationModule.wordLimit = 10;
    assert.strictEqual(texy.process("nejkrásnějšími"), "<p>nejkrás\u00ADnějšími</p>\n");
  });

  it("protects code phrases from hyphenation", () => {
    const texy = new Texy();
    assert.strictEqual(
      texy.process("`nejneobhospodařovávatelnějšími` stays"),
      "<p><code>nejneobhospodařovávatelnějšími</code> stays</p>\n",
    );
  });

  it("is disabled via allowed[Syntax.Hyphenation] = false", () => {
    const texy = new Texy();
    texy.allowed[Syntax.Hyphenation] = false;
    assert.strictEqual(
      texy.process("slovo nejneobhospodařovávatelnějšími konec"),
      "<p>slovo nejneobhospodařovávatelnějšími konec</p>\n",
    );
  });

  it("applyTypography adds soft hyphens to a plain string", () => {
    const texy = new Texy();
    assert.strictEqual(
      texy.applyTypography("nejneobhospodařovávatelnějšími"),
      "nejneobhospoda\u00ADřovávatelnější\u00ADmi",
    );
  });
});
