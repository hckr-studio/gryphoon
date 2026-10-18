/**
 * Link/image reference analysis for go-to-definition.
 *
 * The parser keeps the written reference name on resolved nodes
 * (LinkNode.ref, ImageNode.ref) precisely for analyzers like this one;
 * definitions are LinkDefinitionNode / ImageDefinitionNode. All ranges
 * index the normalized source (see @gryphoon/texy's Range).
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import { ImageDefinitionNode, ImageNode, LinkDefinitionNode, LinkNode } from "@gryphoon/texy/nodes.js";

/**
 * Collects reference uses and definitions from a parsed document.
 * @param {import("@gryphoon/texy/nodes.js").DocumentNode} document
 * @returns {{
 *   uses: Array<{ name: string, node: import("@gryphoon/texy/nodes.js").Node }>,
 *   definitions: Map<string, import("@gryphoon/texy/nodes.js").Node>,
 * }}
 */
export function collectReferences(document) {
  const uses = [];
  const definitions = new Map();

  new NodeTraverser().traverse(document, node => {
    if ((node instanceof LinkNode || node instanceof ImageNode) && node.ref) {
      uses.push({ name: node.ref, node });
    } else if (node instanceof LinkDefinitionNode || node instanceof ImageDefinitionNode) {
      definitions.set(node.reference.toLowerCase(), node);
    }
    return null;
  });

  return { uses, definitions };
}

/**
 * The exact source range of the `[ref]` / `[*ref*]` token inside a use
 * node, searched from the end because the target follows the content
 * ("label":[ref]). Falls back to the whole node when the written form is
 * not recoverable (e.g. spacing inside the brackets).
 * @param {{ name: string, node: { range: ?{ offset: number, length: number } } }} use
 * @param {string} normalizedText
 * @returns {?{ offset: number, length: number }}
 */
export function refTokenRange(use, normalizedText) {
  const { range } = use.node;
  if (range === null) {
    return null;
  }

  const slice = normalizedText.slice(range.offset, range.offset + range.length);
  for (const token of [`[*${use.name}*]`, `[${use.name}]`]) {
    const at = slice.lastIndexOf(token);
    if (at !== -1) {
      return { offset: range.offset + at, length: token.length };
    }
  }

  return range;
}
