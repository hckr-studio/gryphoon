/**
 * Processes paragraphs and handles line breaks (port of
 * Texy\Modules\ParagraphModule - the block gap handler).
 */

import { Modifier } from "../Modifier.js";
import { ContentNode, HtmlTagNode, LineBreakNode, LinkNode, ParagraphNode, PhraseNode, TextNode } from "../nodes.js";
import { OffsetMap } from "../Parsing/OffsetMap.js";
import { ModifierHAlign, Modifier as ModifierPattern } from "../Patterns.js";
import { Range } from "../Range.js";
import { match, split } from "../Regexp.js";
import { Module } from "./Module.js";

/** Phrasing elements per the reference Schema; anything else counts as block HTML. */
export const inlineElements = new Set([
  "a",
  "abbr",
  "audio",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "datalist",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "label",
  "map",
  "mark",
  "q",
  "ruby",
  "s",
  "samp",
  "slot",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "template",
  "time",
  "u",
  "var",
  "area",
  "br",
  "embed",
  "img",
  "input",
  "link",
  "meta",
  "wbr",
  "button",
  "canvas",
  "iframe",
  "math",
  "meter",
  "noscript",
  "object",
  "output",
  "picture",
  "progress",
  "script",
  "select",
  "svg",
  "textarea",
  "video",
]);

export class ParagraphModule extends Module {
  constructor(texy) {
    super();
    this.texy = texy;

    /** joining consecutive lines into one paragraph; false = every newline is a line break */
    this.mergeLines = true;
  }

  /**
   * Parse text into paragraphs (split by blank lines).
   * @param {import('../Parsing/ParseContext.js').ParseContext} context
   * @param {string} text
   * @param {number} baseOffset
   * @returns {ParagraphNode[]}
   */
  parseText(context, text, baseOffset = 0) {
    const parts = split(text, String.raw`~(\n{2,})~`, { skipEmpty: true });
    const res = [];

    for (const [part, partOffset] of parts) {
      const offset = partOffset + baseOffset;
      const trimmed = part.trim();
      if (trimmed === "") continue;

      // Calculate offset after leading whitespace trim
      const leadingTrim = part.length - part.replace(/^[\t\n\r\0\x0B ]+/, "").length;
      const contentOffset = offset + leadingTrim;

      // Text starting with a block element - parse without soft line
      // breaks, unless the policy rejects it
      let node = this.startsWithBlockElement(trimmed)
        ? this.parseBlockHtml(context, trimmed, contentOffset)
        : null;
      if (node === null || !this.containsBlockHtmlTag(node.content.children)) {
        node = this.parseParagraph(context, trimmed, contentOffset);
        node.blockHtml = this.containsBlockHtmlTag(node.content.children);
      }

      if (this.isEmptyParagraph(node)) continue;

      res.push(node);
    }

    return res;
  }

  /**
   * Check if text starts with a known block-level HTML element.
   */
  startsWithBlockElement(text) {
    const m = text.match(/^<([a-z][a-z0-9]*)\b/i);
    if (!m) return false;
    // Not in inline elements = block element
    return !inlineElements.has(m[1].toLowerCase());
  }

  /**
   * Parse text that starts with block HTML element (no soft line break processing).
   */
  parseBlockHtml(context, text, baseOffset = 0) {
    const content = context.parseInline(text, baseOffset);
    const node = new ParagraphNode(content, null, new Range(baseOffset, text.length));
    node.blockHtml = true;
    return node;
  }

  /**
   * Check if content contains a block-level HtmlTagNode the policy accepts.
   * Block = any HtmlTagNode that is NOT an inline element.
   */
  containsBlockHtmlTag(content) {
    for (const node of content) {
      if (node instanceof HtmlTagNode && !node.closing) {
        const tagName = node.name.toLowerCase();
        // Not an inline element = block element (includes custom elements)
        if (
          !inlineElements.has(tagName) &&
          this.texy.htmlPolicy.isTagAcceptable(tagName, node.attributes, false)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if paragraph contains only whitespace.
   */
  isEmptyParagraph(node) {
    for (const child of node.content.children) {
      if (child instanceof TextNode) {
        if (child.text.trim() !== "") return false;
      } else {
        return false;
      }
    }
    return true;
  }

  /**
   * Parses a single paragraph: extracts the trailing modifier, joins lines
   * (' ' merged / "\r" hard break), parses inline and expands hard breaks.
   */
  parseParagraph(context, text, baseOffset = 0) {
    let lines = OffsetMap.linesOf(text, baseOffset);

    // Extract modifier from paragraph; MODIFIER_H cannot span lines, so
    // the removal only shortens the end of a single line
    let modifier = null;
    const mx = match(text, "~" + ModifierHAlign + String.raw`(?= \n | \z)~sUmx`);
    if (mx) {
      const mMod = mx.matches[1];
      const cutOffset = baseOffset + mx.offsets[0]; // full match incl. leading spaces and dot
      lines = lines.map(line => {
        const local = cutOffset - line.offset;
        if (local >= 0 && local <= line.content.length) {
          return { content: line.content.slice(0, local).replace(/[\t ]+$/, ""), offset: line.offset };
        }
        return line;
      });
      modifier = Modifier.parse(mMod, baseOffset + mx.offsets[1]);
    }

    // the former trim(): drop blank edge lines and edge whitespace
    while (lines.length > 0 && lines[0].content.trim() === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].content.trim() === "") lines.pop();
    if (lines.length === 0) {
      return new ParagraphNode(new ContentNode(), null, new Range(baseOffset, text.length));
    }
    const firstStrip = lines[0].content.match(/^[\t ]*/)[0].length;
    lines[0] = { content: lines[0].content.slice(firstStrip), offset: lines[0].offset + firstStrip };
    lines[lines.length - 1] = {
      content: lines[lines.length - 1].content.replace(/[\t ]+$/, ""),
      offset: lines[lines.length - 1].offset,
    };

    // Join lines with single-character separators: ' ' for merged lines,
    // "\r" for hard breaks. The separators have the same length as the "\n"
    // they replace, so the per-line offset map stays valid.
    let joined = "";
    const mapLines = [];
    for (const [i, line] of lines.entries()) {
      let content = line.content;
      let offset = line.offset;
      if (i > 0) {
        const strip = content.match(/^[\t ]*/)[0].length;
        if (!this.mergeLines) {
          joined += "\r";
        } else if (strip > 0 && strip < content.length) {
          // whitespace-indented continuation line (the former `\n\ +(?=\S)` rule):
          // hard break, indentation stripped
          joined += "\r";
          content = content.slice(strip);
          offset += strip;
        } else {
          joined += " ";
        }
      }
      mapLines.push({ content, offset });
      joined += content;
    }

    // hard breaks are expanded while ranges are still local, then the line
    // map translates everything to source coordinates
    const content = context.parseInline(joined);
    const node = new ContentNode(this.expandLineBreaks(content.children));
    OffsetMap.fromLines(mapLines).applyTo(node);

    return new ParagraphNode(node, modifier, new Range(baseOffset, text.length));
  }

  /**
   * Expand \r markers in TextNode content into LineBreakNode.
   */
  expandLineBreaks(nodes) {
    const result = [];
    for (const node of nodes) {
      if (node instanceof TextNode && node.text.includes("\r")) {
        // sub-ranges are computed from content lengths; gap text is verbatim
        // source, so they are exact unless the \r was decoded from an entity
        let offset = node.range?.offset ?? null;
        const parts = node.text.split("\r");
        for (const [i, part] of parts.entries()) {
          if (i > 0) {
            result.push(new LineBreakNode(offset === null ? null : new Range(offset - 1, 1)));
          }
          if (part !== "") {
            result.push(new TextNode(part, offset === null ? node.range : new Range(offset, part.length)));
          }
          if (offset !== null) offset += part.length + 1;
        }
      } else if (node instanceof PhraseNode) {
        node.content.children = this.expandLineBreaks(node.content.children);
        result.push(node);
      } else if (node instanceof LinkNode) {
        node.content.children = this.expandLineBreaks(node.content.children);
        result.push(node);
      } else {
        result.push(node);
      }
    }
    return result;
  }
}
