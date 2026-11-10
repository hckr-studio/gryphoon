/**
 * Selection ranges: the chain of AST nodes containing a position, from
 * the innermost node out to the document - the expand-selection ladder.
 *
 * The walk descends unconditionally: containers whose range is null
 * (ContentNode) are bridged, and only nodes with a range that contains
 * the offset join the chain. Consecutive equal ranges are collapsed -
 * the LSP chain must grow strictly.
 */

/**
 * @param {import("@gryphoon/texy/nodes.js").DocumentNode} document
 * @param {number} offset normalized offset
 * @returns {Array<{ offset: number, length: number }>} innermost first
 */
export function selectionChain(document, offset) {
  const chain = [];

  const walk = node => {
    const { range } = node;
    if (range !== null && range.offset <= offset && offset < range.offset + range.length) {
      const last = chain[chain.length - 1];
      if (last === undefined || last.offset !== range.offset || last.length !== range.length) {
        chain.push({ offset: range.offset, length: range.length });
      }
    }
    for (const child of node.getChildren()) {
      walk(child);
    }
  };
  walk(document);

  return chain;
}
