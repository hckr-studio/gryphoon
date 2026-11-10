/**
 * Utility for dumping AST structure in the readable format of the reference
 * tests/AstDumper.php: `NodeName [start,end] extra_info`, one node per line,
 * two-space indent per depth.
 *
 * Node ranges are UTF-16 code-unit offsets in this port; the dumper converts
 * them to UTF-8 byte offsets so dumps are directly comparable with the
 * reference fixtures.
 */

import { OffsetMap } from "../../src/Parsing/OffsetMap.js";

/** Maps UTF-16 code-unit indices in `s` to UTF-8 byte offsets. */
export function byteOffsetMap(s) {
  const map = new Array(s.length + 1);
  let byte = 0;
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    map[i] = byte;
    byte +=
      cu >= 0xd800 && cu <= 0xdbff
        ? 4 // surrogate pair -> 4-byte UTF-8
        : cu >= 0x0800
          ? 3
          : cu >= 0x0080
            ? 2
            : 1;
  }
  map[s.length] = byte;
  return map;
}

/**
 * @param {import('../src/Range.js').Node} node
 * @param {string} source the normalized source the document was parsed from
 * @param {?Uint32Array} map precomputed code-unit -> byte offset map
 * @param {number} indent
 * @returns {string}
 */
export function dump(node, source, map = null, indent = 0) {
  map ??= byteOffsetMap(source);

  const name = node.constructor.name;
  let line = "  ".repeat(indent) + name;
  if (node.range) {
    const byteOffset = map[node.range.offset];
    const byteLength = map[node.range.offset + node.range.length] - byteOffset;
    line += ` [${byteOffset},${byteLength}]`;
  }

  const modifier = node.getModifier ? node.getModifier() : null;
  if (modifier?.range) {
    const byteOffset = map[modifier.range.offset];
    const byteLength = map[modifier.range.offset + modifier.range.length] - byteOffset;
    line += ` mod[${byteOffset},${byteLength}]`;
  }

  // parts of the notation: every other range the node holds, plus offset maps
  // (map offsets are converted to bytes like every other range)
  for (const [prop, value] of Object.entries(node)) {
    if (prop === "range") {
      continue;
    }
    if (isRangeLike(value)) {
      const byteOffset = map[value.offset];
      const byteLength = map[value.offset + value.length] - byteOffset;
      line += ` ${prop}[${byteOffset},${byteLength}]`;
    } else if (value instanceof OffsetMap) {
      line += ` ${prop}@${map[value.toAbsolute(0)]}`;
    }
  }

  const extra = getExtraInfo(node);
  if (extra !== "") {
    line += " " + extra;
  }

  let result = line + "\n";
  for (const child of node.getChildren()) {
    result += dump(child, source, map, indent + 1);
  }
  return result;
}

/** Detects every range shape the port uses: {offset, length} plain objects
 * and Range instances (an OffsetMap is not one; it precedes this check). */
function isRangeLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.constructor !== OffsetMap &&
    typeof value.offset === "number" &&
    typeof value.length === "number"
  );
}

function getExtraInfo(node) {
  const cls = node.constructor.name;
  switch (cls) {
    case "TextNode":
    case "RawTextNode":
      return '"' + escapeText(node.text) + '"';
    case "PhraseNode":
      return node.type;
    case "HeadingNode":
      return "level=" + node.level + (node.marker === null ? "" : " marker=" + node.marker);
    case "ListNode":
      return ListTypeOrder[node.type] ? ListTypeOrder[node.type] : node.type;
    case "ListItemNode":
      return node.bullet === null ? "" : "bullet=" + node.bullet;
    case "CodeBlockNode":
      return node.language ? "lang=" + node.language : "";
    case "LinkNode":
      return [node.syntax, node.url === null ? null : "url=" + node.url, node.ref === null ? null : "ref=" + node.ref]
        .filter(part => part !== null && part !== "")
        .join(" ");
    case "ImageNode":
      return phpTruthy(node.url) ? "src=" + node.url : "";
    case "HtmlTagNode":
      return "<" + node.name + ">";
    case "CommentNode":
      return "# " + escapeText(Buffer.from(node.text, "utf8").subarray(0, 20).toString("utf8")); // substr counts bytes
    case "DirectiveNode":
      return node.parseContent().name;
    case "HorizontalRuleNode":
      return "";
    default:
      return "";
  }
}

const ListTypeOrder = {
  ul: "unordered",
  ol: "ordered",
  "upper-roman": "ordered",
  "lower-roman": "ordered",
  "upper-alpha": "ordered",
  "lower-alpha": "ordered",
};

/** PHP boolean cast: '' and '0' are falsy. */
function phpTruthy(s) {
  return s !== null && s !== undefined && s !== "" && s !== "0";
}

function escapeText(s) {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
}
