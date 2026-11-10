/**
 * Inlay hints: the resolved target URL of every [ref] / [*ref*] use,
 * right after the use token - the "what will this link to" hint.
 * Unresolved references get no hint (the undefined-reference
 * diagnostic covers them).
 */

import { refTokenRange } from "./links.js";

const MAX_LABEL = 90;

/**
 * @param {{ normalized: string, uses: Array, definitions: Map }} analysis
 * @param {number} from normalized offset of the requested range start
 * @param {number} to normalized offset of the requested range end
 * @returns {Array<{ at: number, label: string }>} at: normalized offset
 */
export function collectInlayHints(analysis, from, to) {
  const hints = [];
  for (const use of analysis.uses) {
    const token = refTokenRange(use, analysis.normalized);
    if (token === null) {
      continue;
    }
    const at = token.offset + token.length;
    if (at < from || at > to) {
      continue;
    }

    const definition = analysis.definitions.get(use.name.toLowerCase());
    if (definition === undefined) {
      continue;
    }
    const url = use.node.url ?? definition.url;
    if (url === null || url === undefined) {
      continue;
    }

    const label = url.length > MAX_LABEL ? url.slice(0, MAX_LABEL - 1) + "…" : url;
    hints.push({ at, label: `→ ${label}` });
  }
  return hints;
}
