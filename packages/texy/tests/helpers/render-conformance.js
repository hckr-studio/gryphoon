/**
 * Shared fixture conformance runner: every tests/Texy/sources/*.texy is
 * converted and must match the oracle fixture byte-for-byte. The fixture
 * for emoticon.texy is named emoticon-on.* to flag the non-default setting.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Texy } from "../../src/Texy.js";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // tests/helpers -> package root

/**
 * @param {Object} options
 * @param {string} options.suite describe() title
 * @param {string} options.fixturesDir directory under tests/fixtures/
 * @param {string} options.extension fixture file extension, incl. dot
 * @param {Function} options.convert fn(Texy, source): string
 * @param {Function} options.configure fn(Texy, fixtureName): void - set up allowed flags to match the oracle config
 * @param {Set<string>} [options.knownDivergences] fixture names to skip, with documented reasons
 */
export function renderConformance({ suite, fixturesDir, extension, convert, configure, knownDivergences = new Set() }) {
  const dir = join(root, "tests", "fixtures", fixturesDir);
  const sourcesDir = join(root, "..", "..", "tests", "Texy", "sources");
  const fixtures = readdirSync(dir).filter(f => f.endsWith(extension));

  describe(suite, () => {
    for (const fixture of fixtures) {
      const name = fixture.slice(0, -extension.length);

      it(`${name}.texy`, () => {
        if (knownDivergences.has(name)) {
          return; // documented divergence
        }

        const sourceName = name === "emoticon-on" ? "emoticon" : name;
        const source = readFileSync(join(sourcesDir, sourceName + ".texy"), "utf8");
        const expected = readFileSync(join(dir, fixture));

        const texy = new Texy();
        configure(texy, name);

        const actual = Buffer.from(convert(texy, source), "utf8");

        if (!actual.equals(expected)) {
          // report the first differing line with context
          const a = actual.toString("utf8").split("\n");
          const e = expected.toString("utf8").split("\n");
          for (let i = 0; i < Math.max(a.length, e.length); i++) {
            if (a[i] !== e[i]) {
              assert.fail(
                `line ${i + 1}\n  actual:   ${JSON.stringify(a.slice(i, i + 2))}\n  expected: ${JSON.stringify(e.slice(i, i + 2))}`,
              );
            }
          }
          assert.fail("outputs differ in length only");
        }
      });
    }
  });
}
