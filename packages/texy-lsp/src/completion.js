/**
 * Completion of link targets: reference names inside a link [ref or
 * image [*ref bracket, and heading anchors after the link-target
 * separator (`"label":#toc-…`, `[title | #toc-…`) - the `#toc-` ids
 * the heading pass generates (headingModule.generateID).
 *
 * Each item's TextEdit replaces the whole partial token (typed prefix
 * through the remaining name chars after the cursor), so accepting a
 * completion never leaves a stale tail.
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import { HeadingNode } from "@gryphoon/texy/nodes.js";

const NAME_CHAR = /[a-zA-Z0-9._-]/;
const ANCHOR_CHAR = /[-a-zA-Z0-9]/;

/**
 * The anchors of the document: one per generated heading id, with
 * the heading title for the detail text.
 * @param {{ ast: Object, normalized: string }} analysis
 * @returns {Array<{ id: string, title: string }>} document order
 */
function headingAnchors(analysis) {
  const anchors = [];
  new NodeTraverser().traverse(analysis.ast, node => {
    if (node instanceof HeadingNode && node.id !== null) {
      const title = node.textRange !== null
        ? analysis.normalized.slice(node.textRange.offset, node.textRange.offset + node.textRange.length).trim()
        : `H${node.level}`;
      anchors.push({ id: node.id, title });
    }
    return null;
  });
  return anchors;
}

/**
 * Link-target completion items at the offset: heading anchors after
 * `#` in a link target, else reference names in a bracket. Null when
 * the cursor is not in either context.
 * @param {{ normalized: string, ast: Object, definitionNodes: Array }} analysis
 * @param {number} offset normalized offset
 * @returns {?Array<{ label: string, kind: number, detail: ?string, edit: { offset: number, length: number }, text: string }>}
 *   edit coordinates are normalized; the server bridges them out
 */
export function completeReferences(analysis, offset) {
  const text = analysis.normalized;

  // heading anchor: the typed token just after `#`, which the link-target
  // separator (`:` or `|`) opens
  let hash = offset;
  while (hash > 0 && ANCHOR_CHAR.test(text[hash - 1])) {
    hash--;
  }
  if (hash > 0 && text[hash - 1] === "#" && (text[hash - 2] === ":" || text[hash - 2] === "|")) {
    let end = offset;
    while (end < text.length && ANCHOR_CHAR.test(text[end])) {
      end++;
    }
    const from = hash - 1; // together with the `#` itself
    const prefix = text.slice(hash, offset).toLowerCase();

    return headingAnchors(analysis)
      .filter(anchor => anchor.id.startsWith(prefix))
      .map(anchor => ({
        label: anchor.id,
        kind: 18, // Reference
        detail: anchor.title,
        edit: { offset: from, length: end - from },
        text: `#${anchor.id}`,
      }));
  }

  // reference name inside a bracket: [ref, [*ref, "label":[ref, [*img*]
  let start = offset;
  while (start > 0 && NAME_CHAR.test(text[start - 1])) {
    start--;
  }
  if (!(start >= 1 && text[start - 1] === "[" || start >= 2 && text[start - 2] === "[" && text[start - 1] === "*")) {
    return null;
  }

  // the rest of the name typed after the cursor belongs to the token
  let end = offset;
  while (end < text.length && NAME_CHAR.test(text[end])) {
    end++;
  }

  const prefix = text.slice(start, offset).toLowerCase();
  const items = [];
  for (const definition of analysis.definitionNodes) {
    if (prefix !== "" && !definition.reference.toLowerCase().startsWith(prefix)) {
      continue;
    }
    items.push({
      label: definition.reference,
      kind: 18, // Reference
      detail: definition.url ?? null,
      edit: { offset: start, length: end - start },
      text: definition.reference,
    });
  }
  items.sort((a, b) => (a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1));

  return items;
}
