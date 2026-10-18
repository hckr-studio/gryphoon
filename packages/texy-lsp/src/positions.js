/**
 * Position conversions: LSP {line, character} in the original document
 * vs. code-unit offsets, including the normalization bridge from
 * @gryphoon/texy (parser offsets index the normalized source).
 */

/**
 * LSP Position of an original-text offset.
 * @param {number[]} lineStarts
 * @param {number} offset
 * @returns {{ line: number, character: number }}
 */
export function positionAt(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: offset - lineStarts[lo] };
}

/**
 * Original-text offset of an LSP Position.
 * @param {number[]} lineStarts
 * @param {{ line: number, character: number }} position
 * @returns {number}
 */
export function offsetAt(lineStarts, position) {
  const line = Math.min(position.line ?? 0, lineStarts.length - 1);
  return lineStarts[line] + (position.character ?? 0);
}

/**
 * The normalized offset an original offset corresponds to: the index of
 * the last mapped code unit at or before it (map is monotonic; positions
 * inside dropped regions clamp to the previous kept unit).
 * @param {Int32Array} map normalized offset -> original offset
 * @param {number} original
 * @returns {number}
 */
export function normalizedOffsetAt(map, original) {
  let lo = 0;
  let hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid] <= original) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * LSP Range of a normalized-source Range {offset, length}, mapped through
 * the normalization bridge into the original document. A null range (no
 * exact source position) covers the whole document.
 * @param {{ offset: number, length: number } | null} range
 * @param {Int32Array} map normalized offset -> original offset
 * @param {number[]} lineStarts
 * @returns {{ start: { line: number, character: number }, end: { line: number, character: number } }}
 */
export function toLspRange(range, map, lineStarts) {
  if (range === null) {
    const last = lineStarts[lineStarts.length - 1];
    return { start: { line: 0, character: 0 }, end: positionAt(lineStarts, last) };
  }

  const from = map[Math.min(range.offset, map.length - 1)];
  const to = map[Math.min(range.offset + range.length, map.length - 1)];
  return { start: positionAt(lineStarts, from), end: positionAt(lineStarts, to) };
}
