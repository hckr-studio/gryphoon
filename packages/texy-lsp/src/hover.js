/**
 * Hover: what a reference resolves to. On a [ref] / [*ref*] use the
 * resolved target (the transform already resolved the URL onto the
 * node); on a definition line the declared target. Plain display text;
 * the server wraps it for the LSP response.
 */

import { useAt, definitionAt } from "./links.js";

/**
 * @param {{ normalized: string, uses: Array, definitions: Map, definitionNodes: Array }} analysis
 * @param {number} offset normalized offset
 * @returns {?string} display text, or null when nothing to hover
 */
export function hoverAt(analysis, offset) {
  const use = useAt(analysis, offset);
  if (use !== null) {
    const definition = analysis.definitions.get(use.name.toLowerCase());
    const url = use.node.url ?? definition?.url ?? null;
    if (url === null) {
      return null;
    }
    const dims = use.node.width != null && use.node.height != null ? ` (${use.node.width}x${use.node.height})` : "";
    return url + dims;
  }

  const definition = definitionAt(analysis, offset);
  if (definition !== null && definition.url) {
    const dims = definition.width != null && definition.height != null ? ` (${definition.width}x${definition.height})` : "";
    return definition.url + dims;
  }

  return null;
}
