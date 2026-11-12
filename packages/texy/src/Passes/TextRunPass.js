/**
 * Applies string transformations (typography) to the AST (port of
 * Texy\Passes\TextRunPass).
 *
 * For every block-level inline container it builds a "text image": TextNode
 * contents joined with the Textual/Replaced/Markup marker characters
 * standing in for protected, replaced and markup content. The image is the
 * contract with the transformers: the typography regexes are written over
 * this marker alphabet. Transformers run over the image and the result is
 * written back into the text nodes. The patterns never create nor destroy
 * marker bytes, so on the way back the markers delimit the runs
 * unambiguously. A marker byte occurring in the text itself travels as a
 * stand-in character.
 */

import { extractText } from "../NodeHelpers.js";
import { DontTraverseChildren, NodeTraverser } from "../NodeTraverser.js";
import {
  AnnotationNode,
  VerbatimBlockNode,
  CommentNode,
  ContentNode,
  DirectiveNode,
  EmailNode,
  HeadingNode,
  ImageNode,
  HtmlCommentNode,
  HtmlElementNode,
  HtmlTagNode,
  ImageDefinitionNode,
  InlineCodeNode,
  InlineNode,
  LinkDefinitionNode,
  LinkNode,
  PhraseNode,
  RawTextNode,
  TextNode,
  UrlNode,
} from "../nodes.js";
import { inlineElements } from "../Output/Html/Schema.js";
import { Syntax } from "../Syntax.js";

/** Opaque protected text (code, URL); breaks words, not transparent to patterns. */
export const Textual = "\x15";
/** Replaced content (images, br); nbsp patterns bind to it. */
export const Replaced = "\x16";
/** Markup boundary; transparent to patterns. */
export const Markup = "\x17";

const markerBytes = /[\x15\x16\x17]/;

/**
 * Private-use characters not occurring in the text to carry its marker bytes through the transformers.
 * @param {string} text
 * @returns {Array<[string, string]>} marker byte => stand-in character
 */
function pickStandIns(text) {
  const chars = [];
  for (let code = 0xe000; chars.length < 3; code++) {
    const char = String.fromCodePoint(code);
    if (!text.includes(char)) {
      chars.push(char);
    }
  }

  return [
    [Textual, chars[0]],
    [Replaced, chars[1]],
    [Markup, chars[2]],
  ];
}

/**
 * @param {string} s
 * @param {Array<[string, string]>} map
 */
function strtr(s, map) {
  for (const [from, to] of map) {
    s = s.split(from).join(to);
  }

  return s;
}

/** @param {Array<[string, string]>} map */
function flipMap(map) {
  return map.map(([from, to]) => [to, from]);
}

/** HTML elements holding code or preformatted text, protected like a code phrase. */
const VerbatimElements = new Set(["code", "kbd", "pre", "samp", "script", "style", "textarea"]);

/** Block-level markup splits the image into segments. */
const Break = null;

export class TextRunPass {
  /**
   * @param {Array<Function>} transformers applied to each image in order: fn(string): string
   * @param {?Function} titleTransformer applied to modifier titles (isolated strings): fn(string): string
   */
  constructor(transformers, titleTransformer = null) {
    this.transformers = transformers;
    this.titleTransformer = titleTransformer;
  }

  /**
   * @param {import('../nodes.js').DocumentNode} doc
   */
  process(doc) {
    new NodeTraverser().traverse(doc, node => {
      this.transformTitle(node);

      if (node instanceof VerbatimBlockNode) {
        return DontTraverseChildren; // code blocks are protected from typography
      }

      if (node instanceof ContentNode && this.isInlineContainer(node)) {
        this.processUnit(node);
        return DontTraverseChildren;
      }

      return null;
    });
  }

  /**
   * Is the container pure inline content, i.e. one typographic unit?
   * @param {import('../nodes.js').ContentNode} node
   */
  isInlineContainer(node) {
    if (node.children.length === 0) {
      return false;
    }
    for (const child of node.children) {
      if (!(child instanceof InlineNode)) {
        return false;
      }
    }

    return true;
  }

  /**
   * @param {*} node
   */
  transformTitle(node) {
    if (this.titleTransformer === null) {
      return;
    }

    const modifier = typeof node.getModifier === "function" ? node.getModifier() : null;
    if (modifier !== null && modifier.title !== null) {
      modifier.title = this.transformIsolated(modifier.title, this.titleTransformer);
    }

    // the {toc: ...} label and the alternative text are display text too
    if (node instanceof HeadingNode && node.titleOverride !== null) {
      node.titleOverride = this.transformIsolated(node.titleOverride, this.titleTransformer);
    } else if (node instanceof ImageNode && node.alt !== null) {
      node.alt = this.transformIsolated(node.alt, this.titleTransformer);
    }
  }

  /**
   * Transforms an isolated string, protecting its marker bytes behind stand-in characters.
   * @param {string} text
   * @param {Function} transform
   */
  transformIsolated(text, transform) {
    const standIns = markerBytes.test(text) ? pickStandIns(text) : [];

    return strtr(transform(strtr(text, standIns)), flipMap(standIns));
  }

  /**
   * Processes one inline container as a typographic unit.
   * @param {import('../nodes.js').ContentNode} content
   */
  processUnit(content) {
    const pieces = [];
    this.collect(content.children, pieces); // also transforms titles of inline nodes

    if (this.transformers.length === 0) {
      return;
    }

    // block-level markup splits the unit into independently processed segments
    let segment = [];
    for (const piece of pieces) {
      if (piece === Break) {
        this.processSegment(segment);
        segment = [];
      } else {
        segment.push(piece);
      }
    }

    this.processSegment(segment);
  }

  /**
   * Builds image pieces for inline nodes.
   * @param {Array<*>} nodes
   * @param {Array<?[string, *]>} pieces
   */
  collect(nodes, pieces) {
    for (const node of nodes) {
      this.transformTitle(node);

      if (node instanceof TextNode) {
        pieces.push([node.text, node]);
      } else if (node instanceof InlineCodeNode) {
        // content is protected from typography; the run length mirrors
        // the visible length so length-sensitive patterns (short
        // last word) judge it fairly
        pieces.push([this.textualRun(node.code), null]);
      } else if (node instanceof PhraseNode) {
        pieces.push([Markup, null]);
        this.collect(node.content.children, pieces);
        pieces.push([Markup, null]);
      } else if (node instanceof LinkNode && this.displaysItsAddress(node)) {
        pieces.push([this.textualRun(node.content.children[0].text), null]); // protected like UrlNode
      } else if (node instanceof LinkNode) {
        pieces.push([Markup, null]);
        this.collect(node.content.children, pieces);
        pieces.push([Markup, null]);
      } else if (node instanceof RawTextNode) {
        // literal text, untouched by typography; the run length mirrors the
        // visible length so length-sensitive patterns judge it fairly
        pieces.push([this.textualRun(node.text), null]);
      } else if (node instanceof AnnotationNode) {
        pieces.push([Markup, null]);
        pieces.push([node.text, node]);
        pieces.push([Markup, null]);
      } else if (node instanceof HtmlTagNode) {
        const inlineType = inlineElements.get(node.name.toLowerCase()) ?? null;
        if (inlineType === null) {
          pieces.push(Break); // block-level tag ends the typographic segment
        } else {
          pieces.push([inlineType ? Replaced : Markup, null]);
        }
      } else if (node instanceof HtmlElementNode) {
        const name = node.name.toLowerCase();
        const inlineType = inlineElements.get(name) ?? null;
        const boundary =
          inlineType === null
            ? Break // block-level element splits the segment
            : [inlineType === 1 ? Replaced : Markup, null];
        pieces.push(boundary);
        // code and preformatted text is protected from typography, like a code phrase
        if (VerbatimElements.has(name)) {
          pieces.push([this.textualRun(extractText(node.content)), null]);
        } else {
          this.collect(node.content.children, pieces);
        }
        pieces.push(boundary);
      } else if (node instanceof HtmlCommentNode) {
        pieces.push([Markup, null]);
      } else if (node instanceof UrlNode) {
        pieces.push([this.textualRun(node.url), null]); // display text is protected from typography
      } else if (node instanceof EmailNode) {
        pieces.push([this.textualRun(node.email), null]);
      } else if (node instanceof DirectiveNode) {
        pieces.push([this.textualRun(node.text), null]);
      } else if (
        node instanceof CommentNode ||
        node instanceof ImageDefinitionNode ||
        node instanceof LinkDefinitionNode
      ) {
        // renders to nothing
      } else {
        // ImageNode, LineBreakNode, EmoticonNode, unknown inline nodes
        pieces.push([Replaced, null]);
      }
    }
  }

  /**
   * Is the text of the link its own address, as an autolink of Markdown writes it?
   * @param {import('../nodes.js').LinkNode} node
   */
  displaysItsAddress(node) {
    const children = node.content.children;

    return (
      children.length === 1 &&
      children[0] instanceof TextNode &&
      [children[0].text, `mailto:${children[0].text}`, `http://${children[0].text}`].includes(node.url)
    );
  }

  /**
   * Applies transformers to the segment image and writes the result back.
   * @param {Array<[string, ?*]>} pieces
   */
  processSegment(pieces) {
    let writable = false;
    for (const [, target] of pieces) {
      writable = writable || target !== null;
    }
    if (!writable) {
      return;
    }

    let whole = "";
    for (const [text] of pieces) {
      whole += text;
    }

    // a marker byte occurring in writable text travels as a stand-in character
    let standIns = [];
    for (const [text, target] of pieces) {
      if (target !== null && markerBytes.test(text)) {
        standIns = pickStandIns(whole);
        break;
      }
    }

    let image = "";
    for (const [text, target] of pieces) {
      image += target === null ? text : strtr(text, standIns);
    }

    let transformed = image;
    for (const transformer of this.transformers) {
      transformed = transformer(transformed);
    }

    if (transformed === image) {
      return;
    }

    this.writeBack(pieces, transformed, flipMap(standIns));
  }

  /**
   * Distributes the transformed image back into writable nodes, using the
   * marker pieces (never created nor destroyed by patterns) as delimiters.
   * Text between two markers belongs to the writable runs of that gap;
   * with several runs in one gap the first receives everything. Writes are
   * planned first and applied only when every marker was located, so a
   * failed lookup leaves the AST untouched.
   * @param {Array<[string, ?*]>} pieces
   * @param {string} transformed
   * @param {Array<[string, string]>} originals stand-in character => marker byte it replaced
   */
  writeBack(pieces, transformed, originals) {
    // phase 1: locate the markers, plan writes (no mutation yet)
    let pos = 0;
    let gap = []; // writable nodes since last marker
    const writes = []; // planned [node, new content]

    for (const [text, target] of pieces) {
      if (target !== null) {
        gap.push(target);
        continue;
      }

      const idx = transformed.indexOf(text, pos);
      if (idx === -1) {
        // cannot happen unless a pattern eats markers
        return;
      }

      gap.forEach((node, i) => writes.push([node, i === 0 ? transformed.slice(pos, idx) : ""]));

      gap = [];
      pos = idx + text.length;
    }

    gap.forEach((node, i) => writes.push([node, i === 0 ? transformed.slice(pos) : ""]));

    // phase 2: apply
    for (const [node, text] of writes) {
      node.text = strtr(text, originals);
    }
  }

  /**
   * Opaque textual run whose length approximates the visible length,
   * capped so it stays a cheap marker.
   * @param {string} visible
   * @returns {string}
   */
  textualRun(visible) {
    return Textual.repeat(Math.min(Math.max([...visible].length, 1), 8));
  }
}
