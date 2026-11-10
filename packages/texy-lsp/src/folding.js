/**
 * Folding-range candidates: multi-line block constructs of the Texy!
 * syntax. Ranges cover the whole construct (the /-- opener through the
 * \-- closer where present) in normalized coordinates; the server
 * converts to line numbers and drops single-line spans, which clients
 * ignore anyway.
 *
 * ListNode, TableNode and DefinitionListNode carry only their first
 * row's span in this port, so their extent is derived from descendant
 * ranges; multi-line list items fold individually inside the
 * whole-list fold. ParagraphNode folds a soft-wrapped paragraph -
 * including paragraphs inside quotes and list items, whose spans then
 * merge with their parent's in the line-space dedupe.
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import { BlockQuoteNode, CodeBlockNode, CommentNode, DefinitionListNode, ListItemNode, ListNode, ParagraphNode, SectionNode, TableNode } from "@gryphoon/texy/nodes.js";
import { positionAt } from "./positions.js";

/** Node class => LSP FoldingRangeKind, null for the default kind. */
const FOLDABLE = new Map([
  [CodeBlockNode, "region"], // /--code, /--pre, /--html, /--text, /--default … \--
  [SectionNode, "region"], // /--div … \--
  [CommentNode, "comment"], // /--comment … \--
  [BlockQuoteNode, null], // > lines
  [ParagraphNode, null], // a soft-wrapped paragraph folds
  [ListNode, null], // 1) / - items
  [DefinitionListNode, null], // term: + - description items
  [TableNode, null], // | rows
  [ListItemNode, null], // a multi-line item folds inside its list
]);

/** Classes whose own range covers only part of the construct. */
const DERIVED_EXTENT = new Set([ListNode, DefinitionListNode, TableNode]);

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

/**
 * Converts foldable spans into LSP FoldingRanges: both span ends bridge
 * from normalized offsets through the map into document lines and
 * single-line spans are dropped (a client cannot fold one line).
 * Identical (start, end, kind) triples collapse - e.g. a multi-line
 * list item carrying a nested list shares the whole list's span, and a
 * single-paragraph quote shares its paragraph's span.
 * @param {Array<{ offset: number, length: number, kind: ?string }>} foldings
 * @param {Int32Array} map normalized offset -> original offset
 * @param {number[]} lineStarts original document line starts
 * @returns {Array<Object>} LSP FoldingRanges
 */
export function toFoldingRanges(foldings, map, lineStarts) {
  const last = map.length - 1;
  const seen = new Set();
  const ranges = [];
  for (const folding of foldings) {
    const start = positionAt(lineStarts, map[Math.min(folding.offset, last)]).line;
    const end = positionAt(lineStarts, map[Math.min(folding.offset + folding.length - 1, last)]).line;
    if (end <= start) {
      continue;
    }
    const key = `${start}:${end}:${folding.kind ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ranges.push(folding.kind === null ? { startLine: start, endLine: end } : { startLine: start, endLine: end, kind: folding.kind });
  }
  return ranges;
}
