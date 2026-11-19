/**
 * Source formatting: rewraps long lines according to the block syntax and
 * formats headings to the requested heading style (see {@link
 * formatHeading}). The leading YAML front matter (`---` … `---`) is never
 * touched - it is data, not prose.
 *
 * The unit of change is one block: a block whose formatted text differs
 * from its source yields a single replacement over its exact span, and
 * everything between blocks (the blank-line gaps) is preserved verbatim -
 * no diffing, no ambiguity. A construct whose semantics live in its exact
 * lines is kept verbatim (code/comment blocks, tables, definitions,
 * horizontal rules, figures); so is anything carrying a modifier or
 * unrecognized. Only paragraphs - top-level, inside blockquotes and
 * inside single-paragraph list items - are rewrapped, and link tokens
 * ("label":[target]) are never broken across lines.
 *
 * Rewrapping a paragraph is semantics-preserving: newlines inside a
 * paragraph are soft wraps. Heading levels come from the source markers,
 * not node.level (the balancing pass may have rebalanced it).
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import {
  BlockQuoteNode,
  CommentNode,
  DefinitionListNode,
  DivNode,
  FigureNode,
  HeadingNode,
  HeadingType,
  HorizontalRuleNode,
  ImageDefinitionNode,
  LinkDefinitionNode,
  ListNode,
  ParagraphNode,
  TableNode,
  VerbatimBlockNode,
} from "@gryphoon/texy/nodes.js";

/** The heading styles: keep the notation as written, or convert. */
export const HeadingStyle = Object.freeze({
  /** each heading stays in the notation it was written in */
  Preserve: "preserve",
  /** convert to the written form (`##### Title`) */
  Inline: "inline",
  /** convert to the underlined form (`Title\n=====`) */
  Multiline: "multiline",
});

/** Underline character => level, the HeadingModule defaults. */
const UNDERLINED_LEVELS = { "#": 1, "*": 2, "=": 3, "-": 4 };

/** Classes kept verbatim: their exact source lines carry the semantics. */
const VERBATIM = new Set([
  CommentNode,
  DefinitionListNode,
  FigureNode,
  HorizontalRuleNode,
  ImageDefinitionNode,
  LinkDefinitionNode,
  TableNode,
  // the whole verbatim block family (/--code, /--pre, /--html, /--text, /--default)
  VerbatimBlockNode,
  DivNode,
]);

/** Node classes whose own range covers only part of the construct. */
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
 * Splits paragraph text into unbreakable tokens; a link token
 * ("label":[target]) glues to its target and bracketed constructs
 * ([*image*], [wiki | link]) stay whole, so wrapping never separates them.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text.match(/"[^"\n]*"\s*:\S*|\[[^[\]\n]*\]|\S+/g) ?? [];
}

/**
 * Greedy wrap in code units (LSP character semantics).
 * @param {string} text single-line text
 * @param {number} width maximum line width
 * @returns {string[]} wrapped lines
 */
function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const token of tokenize(text)) {
    if (line === "") {
      line = token;
    } else if (line.length + 1 + token.length <= width) {
      line += " " + token;
    } else {
      lines.push(line);
      line = token;
    }
  }
  if (line !== "") {
    lines.push(line);
  }
  return lines;
}

/**
 * Rewraps a paragraph's source: soft newlines collapse to spaces first.
 * @param {string} slice the paragraph's verbatim source
 * @param {number} width
 * @returns {string}
 */
function formatParagraph(slice, width) {
  const single = slice.replaceAll("\n", " ").replace(/\s+/g, " ").trim();
  return wrap(single, width).join("\n");
}

/**
 * The written marker run of a heading level: the parser reads the level
 * from the run length (more `#` or `=` means a higher heading), and a
 * single character is not a heading, so a level-1 heading is `#######`.
 * @param {number} level 1..6
 * @param {boolean} moreMeansHigher
 * @returns {string}
 */
function runOfLevel(level, moreMeansHigher) {
  const length = Math.min(7, Math.max(2, moreMeansHigher ? 8 - level : level + 1));
  return "#".repeat(length);
}

/**
 * The rank of every heading level used in the document, by the balanced
 * levels (node.level) ascending: the base of the multiline conversion.
 * @param {Object} document
 * @returns {Map<number, number>} level => 0-based rank
 */
function headingLevelRanks(document) {
  const levels = new Set();
  new NodeTraverser().traverse(document, node => {
    if (node instanceof HeadingNode) {
      levels.add(node.level);
    }
    return null;
  });
  return new Map([...levels].sort((a, b) => a - b).map((level, rank) => [level, rank]));
}

/**
 * Formats a heading to the requested style. `preserve` keeps each heading
 * in the notation it was written in (the written form keeps its closing
 * marker run stripped, the underlined form is verbatim - a modifier may
 * ride on its title line). `inline` converts underlined headings to the
 * written form by their source marker level. `multiline` converts written
 * headings by the RANK of their balanced level among the document's
 * heading levels: the underlined notation has only four characters
 * (`#`, `*`, `=`, `-`), while the written runs span six levels (`##` is
 * the deepest), so a typical `##`/`###` document converts by rank
 * (levels 1-2), not by written depth. A rank beyond the fourth level
 * has no underline character and keeps the written form.
 * @param {Object} node HeadingNode
 * @param {string} slice the heading's verbatim source
 * @param {string} style one of HeadingStyle
 * @param {?Object} headingModule the Texy HeadingModule (levels, moreMeansHigher)
 * @param {?Map<number, number>} levelRanks level => rank, the multiline base
 * @returns {string}
 */
function formatHeading(node, slice, style, headingModule, levelRanks) {
  const levels = headingModule?.levels ?? UNDERLINED_LEVELS;
  const moreMeansHigher = headingModule?.moreMeansHigher ?? true;
  const lines = slice.split("\n");

  if (node.type === HeadingType.Underlined) {
    if (style !== HeadingStyle.Inline) {
      return slice;
    }
    const level = levels[node.marker] ?? 1;
    return runOfLevel(level, moreMeansHigher) + " " + lines[0].trim();
  }

  // written form: rebuild from the opening marker run, without the
  // optional closing marker run
  const run = slice.match(/^[ \t]*([#=]+)/)?.[1] ?? node.marker ?? "##";
  const title = slice
    .replace(/^[ \t]*[#=]+[ \t]*/, "")
    .replace(new RegExp(`[ \\t]${run[0]}+(?=[ \\t]*(?:$|\\.(?:\\(|\\[|\\{)|[<>^_=-]))`), " ")
    .trim();
  if (style !== HeadingStyle.Multiline) {
    return run + " " + title;
  }

  // written -> underlined: by the rank of the balanced level among the
  // document's heading levels, then the first underline character mapped
  // to that rank
  const underlinedLevel = (levelRanks?.get(node.level) ?? node.level - 1) + 1;
  const glyph = Object.entries(levels).find(([, markerLevel]) => markerLevel === underlinedLevel)?.[0];
  if (glyph === undefined) {
    return run + " " + title; // a rank beyond the fourth underline character: keep the written form
  }
  return title + "\n" + glyph.repeat(Math.max(3, title.length));
}

/**
 * Formats one block node to source text.
 * @param {Object} node
 * @param {string} text the normalized source (absolute ranges)
 * @param {string} slice the node's verbatim source (its extent)
 * @param {number} width
 * @param {string} headingStyle one of HeadingStyle
 * @param {?Object} headingModule the Texy HeadingModule
 * @param {?Map<number, number>} levelRanks level => rank, the multiline base
 * @returns {string}
 */
function formatBlock(node, text, slice, width, headingStyle, headingModule, levelRanks) {
  if (node instanceof HeadingNode) {
    return formatHeading(node, slice, headingStyle, headingModule, levelRanks);
  }

  if (node instanceof ParagraphNode) {
    return formatParagraph(slice, width);
  }

  if (node instanceof BlockQuoteNode && node.modifier === null) {
    // only a single-paragraph quote is rewrapped: the prefix is stripped,
    // the paragraph wrapped, and the prefix re-applied per line; anything
    // else keeps its exact source
    const children = node.content.children;
    if (children.length === 1 && children[0] instanceof ParagraphNode && children[0].range !== null) {
      const stripped = slice.replace(/^>[ ]?/gm, "");
      return formatParagraph(stripped, width - 2)
        .split("\n")
        .map(line => (line === "" ? ">" : "> " + line))
        .join("\n");
    }
    return slice;
  }

  if (node instanceof ListNode && node.modifier === null) {
    return node.items.map(item => formatListItem(item, text, width)).join("\n");
  }

  return slice; // verbatim, modifier included
}

/**
 * Formats a single list item; only a plain single-paragraph item is
 * rewrapped (nested lists and multi-block items keep their source).
 * @param {Object} item ListItemNode
 * @param {string} text the normalized source (item ranges are absolute)
 * @param {number} width
 * @returns {string}
 */
function formatListItem(item, text, width) {
  const slice = item.range === null ? "" : text.slice(item.range.offset, item.range.offset + item.range.length);
  const blocks = item.content?.children ?? [];
  if (item.modifier !== null || !(blocks.length === 1 && blocks[0] instanceof ParagraphNode)) {
    return slice;
  }

  const marker = slice.match(/^(?:[-*+]|\d+[.)])/)?.[0] ?? "";
  const markerWidth = marker === "" ? 0 : marker.length + 1; // + the one space after the marker
  // continuation-line indents collapse inside formatParagraph with the
  // rest of the soft whitespace
  const content = formatParagraph(slice.slice(markerWidth), width - markerWidth);
  return marker + " " + content.replaceAll("\n", "\n" + " ".repeat(markerWidth));
}

/**
 * Formats a sequence of sibling blocks: one edit per block whose formatted
 * text differs from its source; the gaps between blocks are never touched.
 * @param {Object[]} blocks nodes with absolute ranges
 * @param {string} text the normalized source (absolute ranges)
 * @param {number} width
 * @param {string} headingStyle one of HeadingStyle
 * @param {?Object} headingModule the Texy HeadingModule
 * @returns {Array<{ range: { offset: number, length: number }, text: string }>}
 */
export function formatBlocks(
  blocks,
  text,
  width,
  headingStyle = HeadingStyle.Preserve,
  headingModule = null,
  levelRanks = null,
) {
  const edits = [];
  for (const node of blocks) {
    if (node.range === null) {
      continue;
    }
    const extent = DERIVED_EXTENT.has(node.constructor) ? extentOf(node) : node.range;
    if (extent === null) {
      continue;
    }
    const slice = text.slice(extent.offset, extent.offset + extent.length);
    const formatted = formatBlock(node, text, slice, width, headingStyle, headingModule, levelRanks);
    if (formatted !== slice) {
      edits.push({ range: extent, text: formatted });
    }
  }
  return edits;
}

/**
 * Front matter: the leading `---` … `---` fence block (Jekyll-style
 * YAML). To the Texy parser it is an ordinary region (rules, an
 * underlined heading, paragraphs), so the formatter must exclude it
 * explicitly - it is data, not prose, and its lines are never rewrapped
 * or normalized.
 * @param {string} text the normalized source
 * @returns {number} the exclusive end offset, 0 when there is none
 */
function frontMatterEnd(text) {
  if (!text.startsWith("---\n")) {
    return 0;
  }
  let offset = 4;
  while (offset < text.length) {
    const eol = text.indexOf("\n", offset);
    const line = text.slice(offset, eol === -1 ? text.length : eol).trim();
    if (line === "---") {
      return eol === -1 ? text.length : eol + 1;
    }
    if (eol === -1) {
      return 0; // no closing fence: not front matter, just Texy markup
    }
    offset = eol + 1;
  }
  return 0;
}

/**
 * Formats the whole document. The front matter region edits are
 * dropped - the formatter never touches anything before the closing
 * fence.
 * @param {import("@gryphoon/texy/nodes.js").DocumentNode} document
 * @param {string} text the normalized source the document was parsed from
 * @param {number} lineWidth maximum line width, default 80
 * @param {string} [headingStyle] one of HeadingStyle, default Preserve
 * @param {?Object} [headingModule] the Texy HeadingModule, for the levels map
 * @returns {Array<{ range: { offset: number, length: number }, text: string }>} edits in normalized coordinates
 */
export function formatDocument(
  document,
  text,
  lineWidth = 80,
  headingStyle = HeadingStyle.Preserve,
  headingModule = null,
) {
  const levelRanks = headingStyle === HeadingStyle.Multiline ? headingLevelRanks(document) : null;
  const edits = formatBlocks(document.content.children, text, lineWidth, headingStyle, headingModule, levelRanks);
  const fmEnd = frontMatterEnd(text);
  return fmEnd === 0 ? edits : edits.filter(edit => edit.range.offset >= fmEnd);
}
