/**
 * Typography: property-based invariants of the optimized rules.
 *
 * The pattern catalog's literal anchors (a match can only exist when the
 * segment contains the anchor - that is what lets processTypo skip the
 * scan) and the hand-implemented space-before-last-short-word rule are
 * behavior-critical optimizations: a wrong anchor or a diverging
 * translation silently changes typography output. Both are machine-checked
 * here against the reference regexes, with seeded randomness so a failure
 * reproduces from its seed.
 *
 * The fuzz cases are tagged 'fuzz' and excluded from the regular unit run
 * (npm test); run them with npm run test:fuzz - they are deliberately slow.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { definePatterns, bindLastShortWord } from "../src/Typography.js";

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

describe("typography anchors are necessary conditions", () => {
  // near-miss alphabet: the anchor characters in isolation, so a match
  // without the anchor is constructible if the annotation is wrong
  // (quote rules are excluded - their lazy alternation backtracks
  // pathologically on unbalanced quotes; they get their own bounded case)
  const POOL = [...".-(),<>=+-x \t05abTMtmEUR"];

  it("every anchored pattern only matches segments containing its anchor", { tags: ["fuzz"] }, () => {
    const patterns = definePatterns({ singleQuotes: ["\u2018", "\u2019"], doubleQuotes: ["\u201C", "\u201D"] });
    let checked = 0;
    for (const [rule, , anchor] of patterns) {
      if (typeof rule === "function" || anchor === undefined || anchor === '"' || anchor === "'") continue;

      const random = rng(rule.source.length * 7919);
      for (let i = 0; i < 100000; i++) {
        const len = 1 + Math.floor(random() * 30);
        let s = "";
        for (let j = 0; j < len; j++) {
          s += POOL[Math.floor(random() * POOL.length)];
        }
        if (s.search(rule) !== -1) {
          checked++;
          assert.ok(
            s.includes(anchor),
            `anchor ${JSON.stringify(anchor)} is not necessary: /${rule.source}/ matched ${JSON.stringify(s)}`,
          );
        }
      }
    }
    assert.ok(checked > 500, `the fuzz produced only ${checked} matches; the pool needs widening`);
  });

  it("the quote anchors are necessary (bounded strings: the rules backtrack on long unbalanced quotes)", {
    tags: ["fuzz"],
  }, () => {
    const patterns = definePatterns({ singleQuotes: ["\u2018", "\u2019"], doubleQuotes: ["\u201C", "\u201D"] });
    const POOL = [..."ab \t\"'"];
    let checked = 0;
    for (const [rule, , anchor] of patterns) {
      if (anchor !== '"' && anchor !== "'") continue;

      const random = rng(rule.source.length * 7919);
      for (let i = 0; i < 30000; i++) {
        const len = 1 + Math.floor(random() * 6); // short: bounded backtracking
        let s = "";
        for (let j = 0; j < len; j++) {
          s += POOL[Math.floor(random() * POOL.length)];
        }
        if (s.search(rule) !== -1) {
          checked++;
          assert.ok(
            s.includes(anchor),
            `anchor ${JSON.stringify(anchor)} is not necessary: /${rule.source}/ matched ${JSON.stringify(s)}`,
          );
        }
      }
    }
    assert.ok(checked > 100, `the fuzz produced only ${checked} matches; the pool needs widening`);
  });
});

describe("bindLastShortWord matches the reference regex", () => {
  const REFERENCE = /(?<=.{50})\s+(?=[\x17-\x1F]*\S{1,6}[\x17-\x1F]*$)/gsu;

  const targeted = [
    "",
    " ",
    "a",
    "a".repeat(49) + " b",
    "a".repeat(50) + " b",
    "a".repeat(50) + " bcdefg",
    "a".repeat(50) + " bcdefgh",
    "a".repeat(50) + " bcdefghi",
    "a".repeat(50) + "\x17" + "bcdef" + "\x17",
    "a".repeat(50) + " " + "\x17".repeat(10),
    "a".repeat(50) + " a\x17b\x18c\x19d\x1ae",
    "a".repeat(50) + " a\x17b\x18c\x19d\x1ae\x1ff",
    " ".repeat(100) + " slovo",
    "x".repeat(49) + "  " + "abc",
    "x".repeat(50) + "  " + "abc",
    " ".repeat(49) + "\u00A0 slovo",
    "x".repeat(60) + "\u00A0" + " ab",
    "x".repeat(60) + " ab\n",
    "x".repeat(50) + "\t\tab",
    "x".repeat(55) + " \u2028 ab",
    "x".repeat(55) + " " + "\uFEFF" + "ab",
  ];

  it("targeted boundary cases", () => {
    for (const s of targeted) {
      assert.strictEqual(bindLastShortWord(s), s.replaceAll(REFERENCE, "\u00A0"), JSON.stringify(s));
    }
  });

  it("seeded fuzz, markers and JS whitespace included", { tags: ["fuzz"] }, () => {
    const POOL = [
      "a",
      "b",
      "ö",
      " ",
      "\t",
      "\n",
      "\u00A0",
      "\u2000",
      "\u2028",
      "\uFEFF",
      "\x17",
      "\x1a",
      "\x1f",
      "xxx",
      " ",
    ];
    const random = rng(0x5eed);
    for (let i = 0; i < 150000; i++) {
      const len = 1 + Math.floor(random() * 130);
      let s = "";
      for (let j = 0; j < len; j++) {
        s += POOL[Math.floor(random() * POOL.length)];
      }
      assert.strictEqual(bindLastShortWord(s), s.replaceAll(REFERENCE, "\u00A0"), JSON.stringify(s));
    }
  });
});
