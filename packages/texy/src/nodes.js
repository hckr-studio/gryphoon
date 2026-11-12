/**
 * AST node classes (port of Texy\Nodes\*).
 *
 * Two abstract families mirror the reference: BlockNode (block-level
 * constructs) and InlineNode (inline constructs). Child lists are held in
 * ContentNode containers. Traversal order of getChildren() matches the
 * reference AstDumper output exactly (caption before rows in tables, image
 * before caption in figures, etc.).
 */

import { Node } from "./Range.js";

/** @typedef {Object<string, string>} Meta */ // document-level options from {{texy: ...}}

/** @enum {string} */
export const HeadingType = Object.freeze({ Underlined: "Underlined", Surrounded: "Surrounded" });

/** List type: element name (ul/ol) or list-style-type value. */
export const ListType = Object.freeze({
  Unordered: "ul",
  Decimal: "ol",
  UpperRoman: "upper-roman",
  LowerRoman: "lower-roman",
  UpperAlpha: "upper-alpha",
  LowerAlpha: "lower-alpha",

  isOrdered(type) {
    return type !== ListType.Unordered;
  },

  getStyleType(type) {
    return type === ListType.Unordered || type === ListType.Decimal ? null : type;
  },
});

/** Abstract base of block-level nodes. */
export class BlockNode extends Node {}
export class InlineNode extends Node {}

/** Container for node content (inline or block children). */
export class ContentNode extends Node {
  /**
   * @param {Array<Node>} children
   */
  constructor(children = []) {
    super();
    this.children = children;
  }

  /** @returns {Array<Node>} */
  getChildren() {
    return this.children;
  }

  /**
   * A content of one TextNode with no range (port of ContentNode::fromText).
   * @param {string} text
   * @returns {ContentNode}
   */
  static fromText(text) {
    return new ContentNode([new TextNode(text)]);
  }
}

/** Root document node. */
export class DocumentNode extends BlockNode {
  /**
   * @param {ContentNode} content
   * @param {?Range} range
   */
  constructor(content = new ContentNode(), range = null) {
    super();
    /** @type {Object<string, boolean>} document-level options collected from {{texy: ...}} directives */
    this.meta = {};
    this.content = content;
    this.range = range;
  }

  getChildren() {
    return [this.content];
  }
}

export class ParagraphNode extends BlockNode {
  /**
   * @param {ContentNode} content
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(content = new ContentNode(), modifier = null, range = null) {
    super();
    this.content = content;
    this.modifier = modifier;
    this.range = range;
    /** true when the content is a block-level HTML passthrough (no <p> wrapper) */
    this.blockHtml = false;
  }

  getChildren() {
    return [this.content];
  }

  getModifier() {
    return this.modifier;
  }
}

export class HeadingNode extends BlockNode {
  /**
   * @param {ContentNode} content
   * @param {number} level preliminary level; balancing is a transform pass
   * @param {string} type one of HeadingType
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?string} marker the underline character or the opening sequence as written, e.g. '-' or '###'
   * @param {?Range} textRange
   */
  constructor(content, level, type, modifier = null, range = null, marker = null, textRange = null) {
    super();
    this.content = content;
    this.level = level;
    this.type = type;
    this.modifier = modifier;
    /** filled by the HeadingPass (transform phase) */
    this.id = null;
    this.titleOverride = null;
    this.range = range;
    this.marker = marker;
    this.textRange = textRange;
  }

  getChildren() {
    return [this.content];
  }

  getModifier() {
    return this.modifier;
  }
}

export class BlockQuoteNode extends BlockNode {
  /**
   * @param {ContentNode} content
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(content = new ContentNode(), modifier = null, range = null) {
    super();
    this.content = content;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return [this.content];
  }

  getModifier() {
    return this.modifier;
  }
}

/**
 * Base of verbatim /-- blocks: $code is the source text outdented, $codeMap
 * maps its offsets back to the source.
 */
export class VerbatimBlockNode extends BlockNode {
  /**
   * @param {string} code
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?OffsetMap} codeMap maps offsets in code to the source, which differs from it by the stripped indentation
   */
  constructor(code, modifier = null, range = null, codeMap = null) {
    super();
    this.code = code;
    this.modifier = modifier;
    this.range = range;
    this.codeMap = codeMap;
  }

  getModifier() {
    return this.modifier;
  }
}

/** Code block written /--code language or as a fenced ```language block. */
export class CodeBlockNode extends VerbatimBlockNode {
  /**
   * @param {string} code
   * @param {?string} language
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?OffsetMap} codeMap
   */
  constructor(code, language = null, modifier = null, range = null, codeMap = null) {
    super(code, modifier, range, codeMap);
    this.language = language;
  }

  getChildren() {
    return [];
  }
}

/**
 * Preformatted text. Written /--pre it holds the markup parsed for HTML tags
 * and entities; a bare /-- shows it as written.
 */
export class PreformattedNode extends VerbatimBlockNode {
  /**
   * @param {string} code
   * @param {ContentNode} content the code parsed for its HTML tags and entities, or the code itself for a bare /--
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?OffsetMap} codeMap
   * @param {?string} syntax name of the syntax it is written in, Syntax.BlockPre or Syntax.BlockDefault for a bare /--
   */
  constructor(code, content = new ContentNode(), modifier = null, range = null, codeMap = null, syntax = null) {
    super(code, modifier, range, codeMap);
    this.content = content;
    this.syntax = syntax;
  }

  getChildren() {
    return [this.content];
  }
}

/** /--html block: source code that knows HTML tags, comments and entities. */
export class HtmlBlockNode extends VerbatimBlockNode {
  /**
   * @param {string} code
   * @param {ContentNode} content the code parsed for its HTML tags, comments and entities
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?OffsetMap} codeMap
   */
  constructor(code, content = new ContentNode(), modifier = null, range = null, codeMap = null) {
    super(code, modifier, range, codeMap);
    this.content = content;
  }

  getChildren() {
    return [this.content];
  }
}

/** /--text block: source shown verbatim, no markup known. */
export class TextBlockNode extends VerbatimBlockNode {
  getChildren() {
    return [];
  }
}

/** /--texysource block: parsed as Texy, its HTML is displayed as source code. */
export class TexySourceNode extends VerbatimBlockNode {
  /**
   * @param {string} code
   * @param {ContentNode} content the code parsed as Texy
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?OffsetMap} codeMap
   */
  constructor(code, content = new ContentNode(), modifier = null, range = null, codeMap = null) {
    super(code, modifier, range, codeMap);
    this.content = content;
  }

  getChildren() {
    return [this.content];
  }
}

/** Div written /--div; the content is parsed as blocks. */
export class DivNode extends BlockNode {
  /**
   * @param {ContentNode} content
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(content = new ContentNode(), modifier = null, range = null) {
    super();
    this.content = content;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return [this.content];
  }

  getModifier() {
    return this.modifier;
  }
}

/** Hidden comment; renders to nothing. */
export class CommentNode extends BlockNode {
  /**
   * @param {string} text
   * @param {?Range} range
   */
  constructor(text, range = null) {
    super();
    this.text = text;
    this.range = range;
  }

  getChildren() {
    return [];
  }
}

export class HorizontalRuleNode extends BlockNode {
  /**
   * @param {string} type first character of the marker, '-' or '*'
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(type, modifier = null, range = null) {
    super();
    this.type = type;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return [];
  }

  getModifier() {
    return this.modifier;
  }
}

export class FigureNode extends BlockNode {
  /**
   * @param {ImageNode|LinkNode} image the image, or a LinkNode wrapping it
   * @param {?ContentNode} caption
   * @param {?string} float left/right alignment from the image modifier; the figure floats, not the image
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(image, caption = null, float = null, modifier = null, range = null) {
    super();
    this.image = image;
    this.caption = caption;
    this.float = float;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return this.caption !== null ? [this.image, this.caption] : [this.image];
  }

  getModifier() {
    return this.modifier;
  }
}

export class ListItemNode extends BlockNode {
  /**
   * @param {ContentNode} content
   * @param {boolean} term definition-list term (dt) vs description (dd)
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?string} bullet the bullet as written, e.g. '-' or '1)'; null for a term
   * @param {?Range} bulletRange
   */
  constructor(
    content = new ContentNode(),
    term = false,
    modifier = null,
    range = null,
    bullet = null,
    bulletRange = null,
  ) {
    super();
    this.content = content;
    this.term = term;
    this.modifier = modifier;
    this.range = range;
    this.bullet = bullet;
    this.bulletRange = bulletRange;
  }

  getChildren() {
    return [this.content];
  }

  getModifier() {
    return this.modifier;
  }
}

export class ListNode extends BlockNode {
  /**
   * @param {ListItemNode[]} items
   * @param {string} type one of ListType
   * @param {?number} start
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(items = [], type = ListType.Unordered, start = null, modifier = null, range = null) {
    super();
    this.items = items;
    this.type = type;
    this.start = start;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return this.items;
  }

  getModifier() {
    return this.modifier;
  }
}

export class DefinitionListNode extends BlockNode {
  /**
   * @param {ListItemNode[]} items alternating terms and descriptions
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(items = [], modifier = null, range = null) {
    super();
    this.items = items;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return this.items;
  }

  getModifier() {
    return this.modifier;
  }
}

export class TableNode extends BlockNode {
  /**
   * @param {TableRowNode[]} rows
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?ContentNode} caption written as |## Text above the first row
   */
  constructor(rows = [], modifier = null, range = null, caption = null) {
    super();
    this.rows = rows;
    this.modifier = modifier;
    this.range = range;
    this.caption = caption;
  }

  getChildren() {
    return this.caption !== null ? [this.caption, ...this.rows] : this.rows;
  }

  getModifier() {
    return this.modifier;
  }
}

export class TableRowNode extends BlockNode {
  /**
   * @param {TableCellNode[]} cells
   * @param {boolean} header
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(cells = [], header = false, modifier = null, range = null) {
    super();
    this.cells = cells;
    this.header = header;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return this.cells;
  }

  getModifier() {
    return this.modifier;
  }
}

export class TableCellNode extends BlockNode {
  /**
   * @param {ContentNode} content
   * @param {number} colspan
   * @param {number} rowspan
   * @param {boolean} header
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(content = new ContentNode(), colspan = 1, rowspan = 1, header = false, modifier = null, range = null) {
    super();
    this.content = content;
    this.colspan = colspan;
    this.rowspan = rowspan;
    this.header = header;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return [this.content];
  }

  getModifier() {
    return this.modifier;
  }
}

/** Inline text with display semantics; renderers escape on output. */
export class TextNode extends InlineNode {
  /**
   * @param {string} text
   * @param {?Range} range
   */
  constructor(text, range = null) {
    super();
    this.text = text;
    this.range = range;
  }

  getChildren() {
    return [];
  }

  /** @returns {string} */
  getPlainText() {
    return this.text;
  }
}

/** Literal source text (code-like content, ''notexy''); escaped on output. */
export class RawTextNode extends InlineNode {
  /**
   * @param {string} text
   * @param {?Range} range
   */
  constructor(text, range = null) {
    super();
    this.text = text;
    this.range = range;
  }

  getChildren() {
    return [];
  }

  /** @returns {string} */
  getPlainText() {
    return this.text;
  }
}

/** Hard line break; renders <br>. */
export class LineBreakNode extends InlineNode {
  /**
   * @param {?Range} range
   */
  constructor(range = null) {
    super();
    this.range = range;
  }

  getChildren() {
    return [];
  }
}

export class PhraseNode extends InlineNode {
  /**
   * @param {ContentNode} content
   * @param {string} type the syntax id (phrase/*)
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(content, type, modifier = null, range = null) {
    super();
    this.content = content;
    this.type = type;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return [this.content];
  }

  getModifier() {
    return this.modifier;
  }
}

/** Inline `code`; its content is not parsed recursively. */
export class InlineCodeNode extends InlineNode {
  /**
   * @param {string} code
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?Range} codeRange span of the code in the source
   */
  constructor(code, modifier = null, range = null, codeRange = null) {
    super();
    this.code = code;
    this.modifier = modifier;
    this.range = range;
    this.codeRange = codeRange;
  }

  getPlainText() {
    return this.code;
  }

  getChildren() {
    return [];
  }

  getModifier() {
    return this.modifier;
  }
}

export class AnnotationNode extends InlineNode {
  /**
   * @param {string} text
   * @param {string} annotation title text
   * @param {?Range} range
   */
  constructor(text, annotation, range = null) {
    super();
    this.text = text;
    this.annotation = annotation;
    this.range = range;
  }

  getChildren() {
    return [];
  }
}

export class LinkNode extends InlineNode {
  /**
   * @param {?string} url
   * @param {ContentNode} content
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {boolean} isImageLink link targets an image URL
   * @param {?string} ref original reference name for links written as [ref]
   * @param {?string} syntax name of the syntax the link is written in, e.g. Syntax.WikiLink
   * @param {?Range} textRange
   * @param {?Range} urlRange where the target is written; for [ref] the same as textRange
   */
  constructor(
    url = null,
    content = new ContentNode(),
    modifier = null,
    range = null,
    isImageLink = false,
    ref = null,
    syntax = null,
    textRange = null,
    urlRange = null,
  ) {
    super();
    this.url = url;
    this.content = content;
    this.modifier = modifier;
    this.range = range;
    this.isImageLink = isImageLink;
    this.ref = ref;
    this.syntax = syntax;
    this.textRange = textRange;
    this.urlRange = urlRange;
  }

  getChildren() {
    return [this.content];
  }

  getModifier() {
    return this.modifier;
  }
}

export class ImageNode extends InlineNode {
  /**
   * @param {?string} url
   * @param {?string} alt alternative text taken out of the modifier
   * @param {?number} width
   * @param {?number} height
   * @param {?string} float left/right alignment taken out of the modifier
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   * @param {?string} ref original reference name for images written as [*ref*]
   * @param {?Range} urlRange
   */
  constructor(url = null, alt = null, width = null, height = null, float = null, modifier = null, range = null, ref = null, urlRange = null) {
    super();
    this.url = url;
    this.alt = alt;
    this.width = width;
    this.height = height;
    this.float = float;
    this.modifier = modifier;
    this.range = range;
    this.ref = ref;
    this.urlRange = urlRange;
  }

  getChildren() {
    return [];
  }

  getModifier() {
    return this.modifier;
  }
}

export class UrlNode extends InlineNode {
  /**
   * @param {string} url
   * @param {?Range} range
   */
  constructor(url, range = null) {
    super();
    this.url = url;
    this.range = range;
  }

  getChildren() {
    return [];
  }
}

export class EmailNode extends InlineNode {
  /**
   * @param {string} email
   * @param {?Range} range
   */
  constructor(email, range = null) {
    super();
    this.email = email;
    this.range = range;
  }

  getChildren() {
    return [];
  }
}

export class EmoticonNode extends InlineNode {
  /**
   * @param {string} emoticon
   * @param {?Range} range
   */
  constructor(emoticon, range = null) {
    super();
    this.emoticon = emoticon;
    /** replacement text/image, filled by the parse phase */
    this.resolved = null;
    this.range = range;
  }

  getChildren() {
    return [];
  }
}

/** {{ ... }} script command. */
export class DirectiveNode extends InlineNode {
  /**
   * @param {string} text inner content
   * @param {?Range} range
   */
  constructor(text, range = null) {
    super();
    this.text = text;
    this.range = range;
    this.name = text.trim();

    // name (arg, arg, ...) or name: arg, arg
    const m = this.name.match(/^([a-z_][a-z0-9_-]*)\s*(?:\(([^()]*)\)|:(.*))$/i);
    if (m) {
      this.name = m[1];
      this.value = (m[3] ?? m[2] ?? "").trim();
      this.args = this.value === "" ? [] : this.value.split(/\s*,\s*/);
    } else {
      this.value = null;
      this.args = [];
    }
  }

  getChildren() {
    return [];
  }
}

export class HtmlTagNode extends InlineNode {
  /**
   * @param {string} name lowercased tag name
   * @param {Object<string, string|boolean>} attributes
   * @param {boolean} closing
   * @param {boolean} selfClosing
   * @param {?Range} range
   */
  constructor(name, attributes = {}, closing = false, selfClosing = false, range = null) {
    super();
    this.name = name;
    this.attributes = attributes;
    this.closing = closing;
    this.selfClosing = selfClosing;
    this.range = range;
  }

  getChildren() {
    return [];
  }
}

/** Paired passthrough HTML element (built by the pairing transform pass). */
export class HtmlElementNode extends InlineNode {
  /**
   * @param {string} name
   * @param {Object<string, string|boolean>} attributes
   * @param {ContentNode} content
   * @param {?HtmlTagNode} closingTag
   * @param {?Range} range
   */
  constructor(name, attributes = {}, content = new ContentNode(), closingTag = null, range = null) {
    super();
    this.name = name;
    this.attributes = attributes;
    this.content = content;
    this.closingTag = closingTag;
    this.range = range;
  }

  getChildren() {
    return [this.content];
  }
}

export class HtmlCommentNode extends InlineNode {
  /**
   * @param {string} text inner comment text
   * @param {?Range} range
   */
  constructor(text, range = null) {
    super();
    this.text = text;
    this.range = range;
  }

  getChildren() {
    return [];
  }
}

/** [*reference*]: url - image definition (resolved in the transform phase). */
export class ImageDefinitionNode extends BlockNode {
  /**
   * @param {string} reference
   * @param {?string} url
   * @param {?string} alt
   * @param {?number} width
   * @param {?number} height
   * @param {?import('./Modifier.js').Modifier} modifier
   * @param {?Range} range
   */
  constructor(reference, url = null, alt = null, width = null, height = null, modifier = null, range = null) {
    super();
    this.reference = reference;
    this.url = url;
    this.alt = alt;
    this.width = width;
    this.height = height;
    this.modifier = modifier;
    this.range = range;
  }

  getChildren() {
    return [];
  }

  getModifier() {
    return this.modifier;
  }
}

/** [reference]: url - link definition (resolved in the transform phase). */
export class LinkDefinitionNode extends BlockNode {
  /**
   * The optional label and modifier of a definition are Texy 3
   * semantics, restored for historical documents (the 4-dev reference
   * deprecates them): a bare [ref] use shows the inline-parsed label
   * as content, and the modifier applies to every use site.
   * @param {string} reference
   * @param {string} url
   * @param {?Range} range
   * @param {?string} label
   * @param {?import('./Modifier.js').Modifier} modifier
   */
  constructor(reference, url, range = null, label = null, modifier = null) {
    super();
    this.reference = reference;
    this.url = url;
    this.range = range;
    this.label = label;
    this.modifier = modifier;
  }

  getChildren() {
    return [];
  }
}
