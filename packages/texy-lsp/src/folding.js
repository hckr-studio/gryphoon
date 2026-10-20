/**
 * Folding-range candidates: multi-line block constructs of the Texy!
 * syntax. Ranges cover the whole construct (the /-- opener through the
 * \-- closer where present) in normalized coordinates; the server
 * converts to line numbers and drops single-line spans, which clients
 * ignore anyway.
 *
 * ListNode and TableNode carry only their first row's span in this port,
 * so their extent is derived from descendant ranges; multi-line list
 * items fold individually inside the whole-list fold.
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import { BlockQuoteNode, CodeBlockNode, CommentNode, ListItemNode, ListNode, SectionNode, TableNode } from "@gryphoon/texy/nodes.js";

/** Node class => LSP FoldingRangeKind, null for the default kind. */
const FOLDABLE = new Map([
  [CodeBlockNode, "region"], // /--code, /--pre, /--html, /--text, /--default … \--
  [SectionNode, "region"], // /--div … \--
  [CommentNode, "comment"], // /--comment … \--
  [BlockQuoteNode, null], // > lines
  [ListNode, null], // 1) / - items
  [TableNode, null], // | rows
  [ListItemNode, null], // a multi-line item folds inside its list
]);

/** Classes whose own range covers only part of the construct. */
const DERIVED_EXTENT = new Set([ListNode, TableNode]);

/**
 * The source extent of a node, derived from all ranges in its subtree.
 * @param {Object} node
 * @returns {?{ offset: number, length: number }}
 */
function extentOf(node) {
  let from = Infinity;
  let to = -Infinity;
  new NodeTraverser().traverse(node, n => {
    if (n.range !== null) {
      from = Math.min(from, n.range.offset);
      to = Math.max(to, n.range.offset + n.range.length);
    }
    return null;
  });
  return from === Infinity ? null : { offset: from, length: to - from };
}

/**
 * Collects foldable block ranges from a parsed document.
 * @param {import("@gryphoon/texy/nodes.js").DocumentNode} document
 * @returns {Array<{ offset: number, length: number, kind: ?string }>}
 */
export function collectFoldings(document) {
  const foldings = [];
  new NodeTraverser().traverse(document, node => {
    const kind = FOLDABLE.get(node.constructor);
    if (kind === undefined) {
      return null;
    }
    const extent = DERIVED_EXTENT.has(node.constructor) ? extentOf(node) : node.range;
    if (extent !== null) {
      foldings.push({ ...extent, kind });
    }
    return null;
  });
  return foldings;
}
