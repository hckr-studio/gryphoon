/**
 * Normalizes text to the canonical form that parsing operates on (port of
 * Texy::normalize): removes the leading byte order mark, converts line
 * endings to \n, strips control characters, right-trims lines and drops
 * blank lines at both ends. Idempotent, so it is safe to apply before
 * storing text and again before parsing.
 *
 * @param {string} text
 * @returns {string}
 * @throws {Error} when the input is not valid UTF-8 (a lone surrogate)
 */

export function normalize(text) {
  if (hasLoneSurrogate(text)) {
    throw new Error("Input is not valid UTF-8 text.");
  }

  // standardize line endings to unix-like
  text = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  // remove control characters; leave \t + \n
  text = text.replace(/[\x00-\x08\x0B-\x1F]+/g, "");

  // right trim line ends
  text = text.replace(/[\t ]+$/gm, "");

  // drop blank lines at both ends and byte order marks at the start;
  // a mark hidden behind blank lines would surface after the trim otherwise
  text = text.replace(/^[\n\u{FEFF}]+/u, "");
  return text.replace(/\n+$/, "");
}

/** A JS string can only be invalid UTF-8 through an unpaired surrogate. */
function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    if (cu >= 0xd800 && cu <= 0xdbff) {
      const lo = s.charCodeAt(++i);
      if (lo === undefined || lo < 0xdc00 || lo > 0xdfff) return true;
    } else if (cu >= 0xdc00 && cu <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Normalizes like normalize() and additionally returns the offset bridge:
 * map[i] is the offset in the original text that normalized code unit i
 * was kept from, and map[text.length] the offset just past the last kept
 * unit. Dropped characters (control characters, the \r of a CRLF pair,
 * right-trimmed blanks, blank lines at the ends) never appear in the map;
 * a normalized range converts to the original by mapping both endpoints.
 *
 * normalize() stays the hot-path implementation; parity with this scanner
 * is pinned by tests.
 *
 * @param {string} text
 * @returns {{ text: string, map: Int32Array }}
 * @throws {Error} when the input is not valid UTF-8 (a lone surrogate)
 */
export function normalizeWithMap(text) {
  if (hasLoneSurrogate(text)) {
    throw new Error("Input is not valid UTF-8 text.");
  }

  // single scan: CRLF -> LF (anchored at the \r), drop control characters,
  // recording the original offset of every kept code unit
  const chars = [];
  const origins = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\r") {
      chars.push("\n");
      origins.push(i);
      if (text[i + 1] === "\n") i++;
      continue;
    }
    const cu = text.charCodeAt(i);
    if (cu <= 0x08 || (cu >= 0x0b && cu <= 0x1f)) continue;
    chars.push(ch);
    origins.push(i);
  }

  // right-trim each line's trailing blanks (compacted in place)
  let w = 0;
  for (let r = 0; r < chars.length; ) {
    let lineEnd = r;
    while (lineEnd < chars.length && chars[lineEnd] !== "\n") lineEnd++;
    let contentEnd = lineEnd;
    while (contentEnd > r && (chars[contentEnd - 1] === " " || chars[contentEnd - 1] === "\t")) contentEnd--;
    for (let k = r; k < contentEnd; k++) {
      chars[w] = chars[k];
      origins[w] = origins[k];
      w++;
    }
    if (lineEnd < chars.length) {
      chars[w] = "\n";
      origins[w] = origins[lineEnd];
      w++;
    }
    r = lineEnd + 1;
  }

  // drop blank lines and byte order marks at the start, blank lines at the end
  let start = 0;
  while (start < w && (chars[start] === "\n" || chars[start] === "\u{FEFF}")) start++;
  let end = w;
  while (end > start && chars[end - 1] === "\n") end--;

  const length = end - start;
  const map = new Int32Array(length + 1);
  for (let i = 0; i < length; i++) map[i] = origins[start + i];
  map[length] = length === 0 ? 0 : origins[start + length - 1] + 1;

  return { text: chars.slice(start, end).join(""), map };
}
