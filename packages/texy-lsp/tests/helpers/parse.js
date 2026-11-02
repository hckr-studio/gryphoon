/**
 * Parses Texy! source for feature-level tests: normalizes with the offset
 * bridge and lints in one pass, so AST ranges index the normalized text
 * and `map` bridges back to the original.
 * @param {string} text
 */
export function parseSource(text) {
  const { text: normalized, map } = normalizeWithMap(text);
  const { document } = new Texy().lint(normalized);
  return { document, normalized, map };
}

import { Texy } from "@gryphoon/texy/Texy.js";
import { normalizeWithMap } from "@gryphoon/texy/normalize.js";
