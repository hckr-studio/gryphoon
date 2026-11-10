/**
 * Document symbols: headings as a hierarchy of outline sections (a
 * heading's extent runs to the next heading of the same or higher
 * level), reference definitions as flat named symbols. Ranges are in
 * normalized coordinates; the server bridges them out.
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import { HeadingNode } from "@gryphoon/texy/nodes.js";
import { definitionTokenRange } from "./links.js";

/**
 * @param {import("@gryphoon/texy/nodes.js").DocumentNode} document
 * @param {string} text the normalized source
 * @param {Array} definitionNodes definition lines (from collectReferences)
 * @returns {{
 *   headings: Array<{ level: number, name: string, offset: number, selection: ?{ offset: number, length: number } }>,
 *   definitions: Array<{ name: string, detail: ?string, range: { offset: number, length: number }, selection: ?{ offset: number, length: number } }>,
 * }}
 */
export function collectDocumentSymbols(document, text, definitionNodes) {
  const headings = [];
  new NodeTraverser().traverse(document, node => {
    if (node instanceof HeadingNode) {
      const selection = node.textRange ?? node.range;
      const name = selection !== null
        ? text.slice(selection.offset, selection.offset + selection.length).trim()
        : node.level ? `H${node.level}` : "Heading";
      headings.push({ level: node.level, name, offset: node.range?.offset ?? 0, selection: node.textRange ?? null });
    }
    return null;
  });

  const definitions = definitionNodes.flatMap(node =>
    node.range === null ? [] : [{
      name: node.reference,
      detail: node.url ?? null,
      range: node.range,
      selection: definitionTokenRange(node, text),
    }],
  );

  return { headings, definitions };
}

/**
 * Nests the collected headings by level: each heading opens a section
 * running to the next heading of the same or higher level (or the end
 * of the document).
 * @param {Array<{ level: number, name: string, offset: number, selection: ?{ offset: number, length: number } }>} headings
 * @param {number} docLength the normalized document length
 * @returns {Array} the heading tree, each entry { level, name, range, selection, children }
 */
export function headingOutline(headings, docLength) {
  // a heading's section ends where the next same-or-higher level heading begins
  const ends = headings.map((heading, i) => {
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= heading.level) {
        return headings[j].offset;
      }
    }
    return docLength;
  });

  const roots = [];
  const stack = []; // open sections, innermost last
  const sectionOf = i => ({
    level: headings[i].level,
    name: headings[i].name,
    range: { offset: headings[i].offset, length: ends[i] - headings[i].offset },
    selection: headings[i].selection ?? { offset: headings[i].offset, length: 0 },
    children: [],
  });

  headings.forEach((heading, i) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    const section = sectionOf(i);
    (stack.length === 0 ? roots : stack[stack.length - 1].children).push(section);
    stack.push(section);
  });

  return roots;
}
