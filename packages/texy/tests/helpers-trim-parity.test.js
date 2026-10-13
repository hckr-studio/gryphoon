/**
 * phpTrim/phpRtrim/phpLtrim: parity of the default-list scan with the
 * character-class regex formulation it replaced, plus the PHP character
 * list semantics (NUL stripped, NBSP/BOM preserved, custom lists behave as
 * sets). The default list takes an allocation-free scan whose only proof
 * of equivalence is this comparison.
 *
 * The fuzz cases are tagged 'fuzz' and excluded from the regular unit run
 * (npm test); run them with npm run test:fuzz - they are deliberately slow.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { phpTrim, phpRtrim, phpLtrim } from "../src/helpers.js";

const TRIM_CHARS = " \t\n\r\0\x0B";

/** Regex character-class escape (the helpers' escapeForClass). */
function escapeForClass(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

/** The pre-optimization formulation, as the oracle. */
function oracleRtrim(s, chars = TRIM_CHARS) {
  return s.replace(new RegExp("[" + chars.split("").map(escapeForClass).join("") + "]+$"), "");
}

function oracleLtrim(s, chars = TRIM_CHARS) {
  return s.replace(new RegExp("^[" + chars.split("").map(escapeForClass).join("") + "]+"), "");
}

/** Deterministic PRNG (mulberry32) - a failing case reproduces from its seed. */
function rng(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("phpTrim parity with the regex formulation", () => {
  it("targeted cases", () => {
    const cases = [
      "  a  ",
      "",
      " \t\n\r\0\x0B ",
      "\0x\0",
      "\u00A0x\u00A0",
      "\uFEFFx\uFEFF",
      "x",
      "   ",
      "--x--",
      "\n\ncode\n\n",
    ];
    for (const s of cases) {
      assert.strictEqual(phpRtrim(s), oracleRtrim(s), JSON.stringify(s));
      assert.strictEqual(phpLtrim(s), oracleLtrim(s), JSON.stringify(s));
      assert.strictEqual(phpTrim(s), oracleLtrim(oracleRtrim(s)), JSON.stringify(s));
    }
  });

  it("seeded fuzz over the default list", { tags: ["fuzz"] }, () => {
    const POOL = [" ", "\t", "\n", "\r", "\0", "\x0B", "a", "ö", "\u00A0", "x", "-", "\u3000"];
    const random = rng(0x7311);
    for (let i = 0; i < 100000; i++) {
      const len = 1 + Math.floor(random() * 40);
      let s = "";
      for (let j = 0; j < len; j++) {
        s += POOL[Math.floor(random() * POOL.length)];
      }
      assert.strictEqual(phpRtrim(s), oracleRtrim(s), JSON.stringify(s));
      assert.strictEqual(phpLtrim(s), oracleLtrim(s), JSON.stringify(s));
      assert.strictEqual(phpTrim(s), oracleLtrim(oracleRtrim(s)), JSON.stringify(s));
    }
  });

  it("custom character lists behave as sets (both ends, regex path)", { tags: ["fuzz"] }, () => {
    const random = rng(0x7312);
    for (let i = 0; i < 30000; i++) {
      const len = 1 + Math.floor(random() * 25);
      let s = "";
      for (let j = 0; j < len; j++) {
        s += "abc-"[Math.floor(random() * 4)];
      }
      for (const list of ["-", "abc", "cba", "ab-", "", "x-"]) {
        assert.strictEqual(
          phpTrim(s, list),
          oracleLtrim(oracleRtrim(s, list), list),
          JSON.stringify(s) + " with list " + JSON.stringify(list),
        );
      }
    }
  });
});
