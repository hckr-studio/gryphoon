/**
 * Renders the AST to the output HTML string (port of
 * Texy\Output\Html\Renderer); needs no live Texy instance. Configuration is
 * read from the Config object; per-document facts (nofollow, typographed)
 * are derived from the document itself at render time, so the instance is a
 * configuration snapshot reusable across documents.
 */

/** phrase syntaxes rendered with the tag of their base syntax, unless phraseTags names one for them */
const PhraseVariants = {
  [Syntax.EmphasisSingleAsterisk]: Syntax.Emphasis,
  [Syntax.EmphasisSingleAsterisk2]: Syntax.Emphasis,
  [Syntax.SuperscriptShort]: Syntax.Superscript,
  [Syntax.SubscriptShort]: Syntax.Subscript,
  [Syntax.AbbreviationQuotes]: Syntax.Abbreviation,
};

import {
  decodeEntities,
  escapeHtml,
  escapeHtmlQuotes,
  normalizeWww,
  phpLtrim,
  phpTrim,
  prependRoot,
  shortenUrl,
} from "../../helpers.js";
import { extractText } from "../../NodeHelpers.js";
import {
  AnnotationNode,
  BlockQuoteNode,
  CodeBlockNode,
  CommentNode,
  ContentNode,
  DefinitionListNode,
  DirectiveNode,
  DivNode,
  DocumentNode,
  EmailNode,
  EmoticonNode,
  FigureNode,
  HeadingNode,
  HorizontalRuleNode,
  HtmlBlockNode,
  HtmlCommentNode,
  HtmlElementNode,
  HtmlTagNode,
  ImageDefinitionNode,
  ImageNode,
  InlineCodeNode,
  LineBreakNode,
  LinkDefinitionNode,
  LinkNode,
  ListItemNode,
  ListNode,
  ListType,
  ParagraphNode,
  PhraseNode,
  PreformattedNode,
  RawTextNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TexySourceNode,
  TextBlockNode,
  TextNode,
  UrlNode,
} from "../../nodes.js";
import { Syntax } from "../../Syntax.js";
import { NodeRenderer } from "../NodeRenderer.js";
import { renderToDom } from "./DomBuilder.js";
import { Element } from "./Element.js";
import { ElementDecorator } from "./ElementDecorator.js";
import { createImageDimensions } from "./ImageDimensionsLoader.js";
import { Raw } from "./Raw.js";
import { inlineElements } from "./Schema.js";
import { WellFormer } from "./WellFormer.js";

/**
 * PHP settype($attrs[$key], 'array'): an existing array or map passes
 * through, scalars become a one-element list, null/undefined an empty
 * composite. PHP arrays serve as both lists and maps; the JS shape is
 * chosen by usage: 'style' is a property map, everything else a list.
 */
function settypeArray(attrs, key) {
  const v = attrs[key];
  if (v !== undefined && v !== null && typeof v === "object") {
    return;
  }
  attrs[key] = key === "style" ? {} : v === undefined || v === null ? [] : [v];
}

export class Renderer extends NodeRenderer {
  /**
   * @param {import('./Config.js').Config} config
   * @param {import('../../HtmlPolicy.js').HtmlPolicy} htmlPolicy
   * @param {import('../../UrlPolicy.js').UrlPolicy} urlPolicy
   * @param {?Function} postLine typography for isolated strings (title, alt); null = disabled
   */
  constructor(config, htmlPolicy, urlPolicy, postLine = null) {
    super();
    this.config = config;
    this.htmlPolicy = htmlPolicy;
    this.urlPolicy = urlPolicy;
    this.postLine = postLine;
    /** rendering a wrapperless paragraph: hard line breaks are plain "\n" */
    this.plainBreaks = false;
    this.noFollow = config.linkNoFollow;
    this.titleTypography = true;
    this.imageDimensions = createImageDimensions(config);
    this.decorator = new ElementDecorator(htmlPolicy, urlPolicy, config, this);

    this.handlers.set(DocumentNode, n => this.renderDocument(n));
    this.handlers.set(TextNode, n => n.text);
    this.handlers.set(ContentNode, n => this.wrapChildren(this.renderNodes(n.children)));

    // Block nodes
    this.handlers.set(ParagraphNode, n => this.renderParagraph(n));
    this.handlers.set(HeadingNode, n => this.renderHeading(n));
    this.handlers.set(BlockQuoteNode, n => this.renderBlockQuote(n));
    this.handlers.set(CodeBlockNode, n => this.renderCodeBlock(n));
    this.handlers.set(PreformattedNode, n => this.renderPreformatted(n));
    this.handlers.set(HtmlBlockNode, n => this.renderHtmlBlock(n));
    this.handlers.set(TextBlockNode, n => this.renderTextBlock(n));
    this.handlers.set(TexySourceNode, n => this.renderTexySource(n));
    this.handlers.set(DivNode, n => this.renderDiv(n));
    this.handlers.set(HorizontalRuleNode, n => this.renderHorizontalRule(n));
    this.handlers.set(FigureNode, n => this.renderFigure(n));

    // List nodes
    this.handlers.set(ListNode, n => this.renderList(n));
    this.handlers.set(ListItemNode, n => this.renderListItem(n));
    this.handlers.set(DefinitionListNode, n => this.renderDefinitionList(n));

    // Table nodes
    this.handlers.set(TableNode, n => this.renderTable(n));
    this.handlers.set(TableRowNode, n => this.renderTableRow(n));
    this.handlers.set(TableCellNode, n => this.renderTableCell(n));

    // Inline nodes
    this.handlers.set(ImageNode, n => this.renderImage(n));
    this.handlers.set(LinkNode, n => this.renderLink(n));
    this.handlers.set(PhraseNode, n => this.renderPhrase(n));
    this.handlers.set(InlineCodeNode, n => this.renderInlineCode(n));
    this.handlers.set(RawTextNode, n => escapeHtml(n.text));
    this.handlers.set(AnnotationNode, n => new Element("abbr", { title: n.annotation }).setText(n.text));
    this.handlers.set(EmoticonNode, n => this.renderEmoticon(n));
    this.handlers.set(LineBreakNode, () => (this.plainBreaks ? "\n" : new Raw("<br>")));

    // Autolink nodes
    this.handlers.set(UrlNode, n => this.renderUrl(n));
    this.handlers.set(EmailNode, n => this.renderEmail(n));

    // HTML passthrough nodes
    this.handlers.set(HtmlTagNode, n => this.renderHtmlTag(n));
    this.handlers.set(HtmlElementNode, n => this.renderHtmlElement(n));
    this.handlers.set(HtmlCommentNode, n => this.renderHtmlComment(n));

    // Directive nodes
    this.handlers.set(DirectiveNode, n => this.renderDirective(n));

    // Definition nodes (output empty string)
    this.handlers.set(ImageDefinitionNode, () => "");
    this.handlers.set(LinkDefinitionNode, () => "");
    this.handlers.set(CommentNode, () => "");

    for (const [nodeClass, renderer] of config.getRenderers()) {
      this.addRenderer(nodeClass, renderer);
    }
  }

  /**
   * Render document AST to final HTML string. Per-document facts are read
   * from the document itself: the {{texy: nofollow}} directive and the
   * typographed mark left by the transform phase.
   * @param {DocumentNode} document
   * @returns {string}
   */
  render(document) {
    this.prepareDocument(document);
    return this.finalize(this.renderNode(document));
  }

  /**
   * Renders the document AST onto a linkedom Document (the content lands
   * in the document's <body>) for DOM-side transformation; extension of
   * the reference API for the linkedom-based transform phase.
   * @param {DocumentNode} document
   * @returns the linkedom Document
   */
  renderToDom(document) {
    this.prepareDocument(document);
    return renderToDom(this.renderNode(document));
  }

  /**
   * Derives per-document facts from the document itself.
   * @param {DocumentNode} document
   */
  prepareDocument(document) {
    this.noFollow = this.config.linkNoFollow || Boolean(document.meta.nofollow);
    this.titleTypography = !document.meta.typographed;
  }

  /**
   * Render children as array (for Element.children).
   * @param {Array<*>} content
   * @returns {Array<Element|Raw|string>}
   */
  renderNodes(content) {
    return content.map(child => this.renderNode(child));
  }

  /**
   * Checks whether rendered children produce no visible output (only empty
   * strings/whitespace).
   * @param {Array<Element|Raw|string>} children
   * @returns {boolean}
   */
  renderedToNothing(children) {
    return children.every(child => typeof child === "string" && phpTrim(child) === "");
  }

  /**
   * Applies typography to an isolated string (title, alt) unless the AST was
   * already typographed in the transform phase or typography is disabled.
   * @internal
   * @param {string} s
   * @returns {string}
   */
  postLineText(s) {
    return this.titleTypography && this.postLine !== null ? this.postLine(s) : s;
  }

  /**
   * Turns the rendered document into the final HTML string: walks the
   * Element tree straight into the well-forming engine.
   * @param {Element|Raw|string} root
   * @returns {string}
   */
  finalize(root) {
    const wellFormer = new WellFormer(this.config);
    wellFormer.feed(root);
    return phpLtrim(wellFormer.finish(), "\n");
  }

  /**
   * Well-forms a standalone fragment (texysource); no post-line handlers.
   * @param {Array<Element|Raw|string>} content
   * @returns {string}
   */
  finalizeFragment(content) {
    const wellFormer = new WellFormer(this.config);
    let first = true;
    for (const child of content) {
      if (!first) {
        wellFormer.text("\n");
      }
      first = false;
      wellFormer.feed(child);
    }

    return phpTrim(wellFormer.finish());
  }

  /********************* core node renderers ****************/

  /**
   * @param {DocumentNode} node
   * @returns {Element}
   */
  renderDocument(node) {
    return this.wrapChildren(this.renderNodes(node.content.children));
  }

  /********************* block node renderers ****************/

  /**
   * @param {ParagraphNode} node
   * @returns {Element}
   */
  renderParagraph(node) {
    // Block HTML content - skip <p> wrapper entirely. The parse-time flag is
    // stale when the sanitize pass turned the block tags into text, so its
    // own predicate is re-checked over the transformed content: paragraphs
    // degraded to visible text get a normal <p> again.
    if (node.blockHtml && this.containsBlockPassthrough(node.content.children)) {
      return this.renderWithoutBreaks(node.content.children);
    }

    const info = this.analyzeContent(node.content.children);

    // Only markup (HTML tags/comments) without text -> no <p> wrapper. Replaced content
    // with a hard line break gets one for its <br>, unless it stands beside a block tag.
    if (
      !info.hasText &&
      !info.hasOther &&
      info.hasMarkup &&
      node.modifier === null &&
      (info.hasBlock || !info.hasReplaced || !info.hasBreak)
    ) {
      return this.renderWithoutBreaks(node.content.children);
    }

    const children = this.renderNodes(node.content.children);

    // Whole content rendered to nothing (consumed directives, comments) -> no paragraph at all
    if (node.modifier === null && this.renderedToNothing(children)) {
      return this.wrapChildren([]);
    }

    // Only replaced content (images) -> use imageParagraphTag
    if (!info.hasText && !info.hasOther && info.hasReplaced) {
      return this.createNontextParagraph(children, node.modifier);
    }

    // Normal paragraph
    const el = new Element("p");
    this.decorateElement(node.modifier, el);
    el.children = children;
    return el;
  }

  /**
   * Renders the content of a paragraph without a wrapper, where a hard line
   * break is only whitespace.
   * @param {Array<*>} content
   * @returns {Element}
   */
  renderWithoutBreaks(content) {
    this.plainBreaks = true;
    try {
      return this.wrapChildren(this.renderNodes(content));
    } finally {
      this.plainBreaks = false;
    }
  }

  /**
   * @param {HeadingNode} node
   * @returns {Element}
   */
  renderHeading(node) {
    const el = new Element("h" + node.level);
    this.decorateElement(node.modifier, el);
    if (node.id !== null && (node.modifier === null || node.modifier.id === null)) {
      el.attrs.id = node.id; // generated, so not subject to the modifier policy
    }

    el.children = this.renderNodes(node.content.children);
    return el;
  }

  /**
   * @param {BlockQuoteNode} node
   * @returns {Element}
   */
  renderBlockQuote(node) {
    const el = new Element("blockquote");
    this.decorateElement(node.modifier, el);
    el.children = this.renderNodes(node.content.children);
    return el;
  }

  /**
   * @param {CodeBlockNode} node
   * @returns {Element}
   */
  renderCodeBlock(node) {
    const el = new Element("pre");
    this.decorateElement(node.modifier, el);
    // language class, the one highlighters read, prepended before modifier classes
    if (node.language) {
      settypeArray(el.attrs, "class");
      el.attrs.class = ["language-" + node.language.toLowerCase(), ...el.attrs.class];
    }
    el.create("code").add(new Raw(escapeHtml(node.code)));
    return el;
  }

  /**
   * Preformatted text passes its HTML tags and decoded entities through.
   * @param {PreformattedNode} node
   * @returns {Element}
   */
  renderPreformatted(node) {
    const el = new Element("pre");
    this.decorateElement(node.modifier, el);
    el.children = [this.wrapChildren(this.renderNodes(node.content.children))];
    return el;
  }

  /**
   * /--html: passthrough HTML tags and comments.
   * @param {HtmlBlockNode} node
   * @returns {Element|Raw|string}
   */
  renderHtmlBlock(node) {
    return node.code === ""
      ? "\n"
      : this.wrapChildren(this.renderNodes(node.content.children)).add(" ");
  }

  /**
   * /--text: plain text with <br> for newlines, no wrapper.
   * @param {TextBlockNode} node
   * @returns {Raw}
   */
  renderTextBlock(node) {
    return new Raw(escapeHtml(node.code).replaceAll("\n", "<br>") + " ");
  }

  /**
   * /--texysource: the HTML of the parsed demo displayed as source code.
   * @param {TexySourceNode} node
   * @returns {Element}
   */
  renderTexySource(node) {
    const html = this.finalizeFragment(this.renderNodes(node.content.children));
    const el = new Element("pre");
    this.decorateElement(node.modifier, el);
    // language class, the one highlighters read, prepended before modifier classes
    settypeArray(el.attrs, "class");
    el.attrs.class = ["language-html", ...el.attrs.class];
    el.create("code").add(new Raw(escapeHtml(html)));
    return el;
  }

  /**
   * /--div: a div with block-parsed content.
   * @param {DivNode} node
   * @returns {Element}
   */
  renderDiv(node) {
    const el = new Element("div");
    this.decorateElement(node.modifier, el);
    el.children = this.renderNodes(node.content.children);
    return el;
  }

  /**
   * @param {HorizontalRuleNode} node
   * @returns {Element}
   */
  renderHorizontalRule(node) {
    const el = new Element("hr");
    this.decorateElement(node.modifier, el);

    // Add default class if not already set via modifier
    const cls = this.config.horizontalRuleClasses[node.type] ?? null;
    if (cls && !node.modifier?.classes?.[cls]) {
      settypeArray(el.attrs, "class");
      el.attrs.class.push(cls);
    }

    return el;
  }

  /**
   * @param {FigureNode} node
   * @returns {Element}
   */
  renderFigure(node) {
    const el = new Element(this.config.figureTag);

    // Build image via generator - this allows custom ImageNode handlers to work
    el.children = this.renderNodes([node.image]);

    // Caption
    if (node.caption !== null) {
      el.create(this.config.figureTag === "figure" ? "figcaption" : "p").children = this.renderNodes(
        node.caption.children,
      );
    }

    // Modifier classes/styles
    this.decorateElement(node.modifier, el);

    if (this.config.figureClass) {
      el.addClass(this.config.figureClass);
    }
    this.applyFloat(el, node.float);

    return el;
  }

  /**
   * Applies a float alignment to an element: the configured float class or,
   * with no class named for it, the inline float style.
   * @param {Element} el
   * @param {?string} float
   */
  applyFloat(el, float) {
    if (float !== null) {
      this.decorator.applyFloat(el, float);
    }
  }

  /********************* list node renderers ****************/

  /**
   * @param {ListNode} node
   * @returns {Element}
   */
  renderList(node) {
    const el = new Element(ListType.isOrdered(node.type) ? "ol" : "ul");
    this.decorateElement(node.modifier, el);

    if (node.start !== null && node.start > 1) {
      el.attrs.start = node.start;
    }

    const style = ListType.getStyleType(node.type);
    if (style) {
      // modifier may already have set styles, so merge instead of
      // overwriting
      const current = el.attrs.style ?? null;
      const styles = current !== null && typeof current === "object" ? current : {};
      styles["list-style-type"] = style;
      el.attrs.style = styles;
    }

    for (const item of node.items) {
      el.add(this.renderListItem(item));
    }

    return el;
  }

  /**
   * @param {ListItemNode} node
   * @returns {Element}
   */
  renderListItem(node) {
    // Regular list item (li)
    const el = new Element("li");
    this.decorateElement(node.modifier, el);
    el.children = this.renderItemContent(node.content.children);
    return el;
  }

  /**
   * The item is a block container itself, so a wrapper on the block that
   * opens it adds nothing: <li>text<ul></ul></li> needs no <p> around the
   * text. A second paragraph does get one, because there the wrapper is
   * what separates them.
   * @param {Array<*>} content
   * @returns {Array<Element|Raw|string>}
   */
  renderItemContent(content) {
    const first = content[0] ?? null;
    const rest = content.slice(1);

    let opening = null;
    if (first instanceof ParagraphNode && first.modifier === null) {
      opening = this.renderParagraph(first).children;
    } else if (rest.length === 0 && first instanceof FigureNode && first.caption === null && first.modifier === null) {
      opening = this.renderNodes([first.image]);
    }

    return opening === null ? this.renderNodes(content) : [...opening, ...this.renderNodes(rest)];
  }

  /**
   * @param {DefinitionListNode} node
   * @returns {Element}
   */
  renderDefinitionList(node) {
    const el = new Element("dl");
    this.decorateElement(node.modifier, el);

    for (const item of node.items) {
      el.add(this.renderDefinitionItem(item));
    }

    return el;
  }

  /**
   * @param {ListItemNode} node
   * @returns {Element}
   */
  renderDefinitionItem(node) {
    // Definition list item (dt for term=true, dd for term=false)
    const el = new Element(node.term ? "dt" : "dd");
    this.decorateElement(node.modifier, el);
    el.children = node.term ? this.renderNodes(node.content.children) : this.renderItemContent(node.content.children);
    return el;
  }

  /********************* table node renderers ****************/

  /**
   * @param {TableNode} node
   * @returns {Element}
   */
  renderTable(node) {
    const el = new Element("table");
    this.decorateElement(node.modifier, el);

    if (node.caption !== null) {
      el.create("caption").children = this.renderNodes(node.caption.children);
    }

    let elPart = null;
    for (const row of node.rows) {
      if (elPart === null) {
        elPart = new Element(row.header ? "thead" : "tbody");
        el.add(elPart);
      } else if (!row.header && elPart.name === "thead") {
        // switch from thead to tbody
        elPart = new Element("tbody");
        el.add(elPart);
      }
      elPart.add(this.renderTableRow(row));
    }

    // if only thead without tbody, rename to tbody (tbody is required,
    // thead is optional)
    if (elPart !== null && elPart.name === "thead") {
      elPart.name = "tbody";
    }

    return el;
  }

  /**
   * @param {TableRowNode} node
   * @returns {Element}
   */
  renderTableRow(node) {
    const el = new Element("tr");
    this.decorateElement(node.modifier, el);
    for (const cell of node.cells) {
      el.add(this.renderTableCell(cell));
    }

    return el;
  }

  /**
   * @param {TableCellNode} node
   * @returns {Element}
   */
  renderTableCell(node) {
    const el = new Element(node.header ? "th" : "td");
    this.decorateElement(node.modifier, el);

    if (node.colspan > 1) {
      el.attrs.colspan = node.colspan;
    }
    if (node.rowspan > 1) {
      el.attrs.rowspan = node.rowspan;
    }

    el.children = this.renderNodes(node.content.children);
    return el;
  }

  /********************* inline node renderers ****************/

  /**
   * @param {ImageNode} node
   * @returns {Element}
   */
  renderImage(node) {
    // Check URL scheme (security - filter dangerous schemes like javascript:)
    if (node.url === null || !this.urlPolicy.isImageAllowed(node.url)) {
      // URL is missing or fails scheme filter, return just the alternative text
      return this.wrapChildren([this.postLineText(node.alt ?? "")]);
    }

    // Detect dimensions from the file system (imageBasePath)
    const [width, height] = this.imageDimensions.detect(node);

    const el = new Element("img");
    this.decorateElement(node.modifier, el);
    // src and alt are prepended, they win over the decorated attrs (the
    // reference merges with a left-side array union)
    const decorated = el.attrs;
    el.attrs = {
      src: prependRoot(node.url, this.config.imageBaseUrl),
      alt: this.postLineText(node.alt ?? ""),
    };
    for (const [name, value] of Object.entries(decorated)) {
      if (!(name in el.attrs)) {
        el.attrs[name] = value;
      }
    }
    this.applyFloat(el, node.float);

    // dimensions
    el.attrs.width = width;
    el.attrs.height = height;

    return el;
  }

  /**
   * @param {LinkNode} node
   * @returns {Element}
   */
  renderLink(node) {
    // Check URL scheme (security - filter dangerous schemes like
    // javascript:)
    const rawUrl = node.url ?? "";
    if (!this.urlPolicy.isLinkAllowed(rawUrl)) {
      // URL fails scheme filter, return just the content without link
      return this.wrapChildren(this.renderNodes(node.content.children));
    }

    const el = new Element("a");

    // Handle nofollow class (work on a copy, the node must stay
    // untouched)
    let mod = node.modifier;
    let nofollow = false;
    if (mod !== null && mod.classes["nofollow"]) {
      nofollow = true;
      mod = mod.clone();
      delete mod.classes["nofollow"];
    }

    // Apply modifier (title, class, id, style, etc.) before href
    el.attrs.href = null; // trick - reserve position at front
    this.decorateElement(mod, el);

    const normalized = normalizeWww(rawUrl);

    // Prepend root to relative URLs: imageBaseUrl for image links,
    // linkBaseUrl otherwise
    const root = node.isImageLink ? this.config.imageBaseUrl : this.config.linkBaseUrl;
    el.attrs.href = prependRoot(normalized, root);

    // rel="nofollow"
    if (nofollow || (this.noFollow && el.attrs.href.includes("//"))) {
      el.attrs.rel = "nofollow";
    }

    // Add content
    el.children = this.renderNodes(node.content.children);

    return el;
  }

  /**
   * @param {PhraseNode} node
   * @returns {Element}
   */
  renderPhrase(node) {
    const tags = this.config.phraseTags;
    const tag = tags[node.type] ?? tags[PhraseVariants[node.type] ?? ""] ?? "span";

    if (node.type === Syntax.StrongEmphasis) {
      const el = new Element(this.config.phraseTags[Syntax.Strong] ?? "strong");
      this.decorateElement(node.modifier, el);
      const inner = el.create(this.config.phraseTags[Syntax.Emphasis] ?? "em");
      inner.children = this.renderNodes(node.content.children);
      return el;
    }

    // Normal phrases
    const el = new Element(tag);
    this.decorateElement(node.modifier, el);
    el.children = this.renderNodes(node.content.children);
    return el;
  }

  /**
   * Inline `code`: the content is not parsed, it renders escaped.
   * @param {InlineCodeNode} node
   * @returns {Element}
   */
  renderInlineCode(node) {
    const el = new Element(this.config.phraseTags[Syntax.Code] ?? "code");
    this.decorateElement(node.modifier, el);
    // Only escape <, >, & - not quotes
    el.children = [new Raw(escapeHtml(node.code))];
    return el;
  }

  /**
   * @param {EmoticonNode} node
   * @returns {Element|string}
   */
  renderEmoticon(node) {
    const emoji = node.resolved ?? node.emoticon; // resolved is filled by the transform pass

    return this.config.emoticonClass ? new Element("span", { class: this.config.emoticonClass }).setText(emoji) : emoji;
  }

  /********************* autolink node renderers ****************/

  /**
   * @param {UrlNode} node
   * @returns {Element}
   */
  renderUrl(node) {
    const url = normalizeWww(node.url);

    const el = new Element("a", { href: url });
    if (this.noFollow && url.includes("//")) {
      el.attrs.rel = "nofollow";
    }

    // Protect URL text from typography/longwords processing
    const textualUrl = this.config.shortenUrls ? shortenUrl(node.url) : node.url;
    return el.add(new Raw(textualUrl));
  }

  /**
   * @param {EmailNode} node
   * @returns {Element}
   */
  renderEmail(node) {
    const el = new Element("a", { href: "mailto:" + node.email });
    const text = this.config.obfuscateEmail ? new Raw(node.email.replaceAll("@", "&#64;<!-- -->")) : node.email;
    return el.add(text);
  }

  /********************* HTML passthrough node renderers ****************/

  /**
   * @param {HtmlTagNode} node
   * @returns {Raw|string}
   */
  renderHtmlTag(node) {
    const tagName = node.name.toLowerCase();
    let attrs = node.attributes;

    // Check if tag is allowed
    if (!this.htmlPolicy.isTagAllowed(tagName)) {
      return decodeEntities(this.htmlPolicy.reconstructTag(node)); // shown as text
    }

    // Validate tag - reject if validation fails
    const validation = this.htmlPolicy.validateTag(tagName, attrs, node.closing);
    if (validation === false || validation === "drop") {
      // Invalid tag - shown as text in the output
      return decodeEntities(this.htmlPolicy.reconstructTag(node));
    }

    // defense in depth: HtmlSanitizePass has already done this, but a
    // hand-built AST or a policy tightened after parsing must not slip
    // attributes through
    attrs = this.htmlPolicy.filterAttrs(tagName, attrs);

    // Add rel="nofollow" for external links when linkNoFollow is enabled
    if (tagName === "a" && !node.closing && typeof attrs.href === "string") {
      if (this.noFollow && attrs.href.includes("//")) {
        const existingRel = typeof attrs.rel === "string" ? attrs.rel : "";
        const relParts = existingRel !== "" ? existingRel.split(" ") : [];
        if (!relParts.includes("nofollow")) {
          relParts.push("nofollow");
        }
        attrs.rel = relParts.join(" ");
      }
    }

    if (node.closing) {
      return new Raw("</" + escapeHtmlQuotes(tagName) + ">");
    }

    return new Raw("<" + escapeHtmlQuotes(tagName) + Element.formatAttrs(attrs) + ">");
  }

  /**
   * @param {HtmlCommentNode} node
   * @returns {Raw|string}
   */
  renderHtmlComment(node) {
    if (!this.config.passHtmlComments) {
      return "";
    }

    // Sanitize comment content (security: prevent nested comments)
    let content = node.text.replace(/-{2,}/g, " - ");
    content = phpTrim(content, "-");
    return new Raw("<!--" + content + "-->");
  }

  /**
   * Renders paired passthrough element as open tag + children + close
   * tag, delegating to renderHtmlTag() so sanitization and escaping behave
   * exactly like for unpaired tags.
   * @param {HtmlElementNode} node
   * @returns {Element}
   */
  renderHtmlElement(node) {
    const open = new HtmlTagNode(node.name, node.attributes, false, false, node.range);
    const close = node.closingTag ?? new HtmlTagNode(node.name, {}, true);
    return this.wrapChildren([
      this.renderHtmlTag(open),
      ...this.renderNodes(node.content.children),
      this.renderHtmlTag(close),
    ]);
  }

  /********************* directive node renderers ****************/

  /**
   * @param {DirectiveNode} node
   * @returns {string}
   */
  renderDirective(node) {
    // {{texy: ...}} directives are normally consumed by
    // DirectiveModule.processDirectives() in the transform phase; swallow
    // any that reach the renderer (hand-built AST)
    if (node.name === "texy" && node.args.length > 0) {
      return "";
    }

    // Unknown directives - preserve original text (entities decoded like
    // any display text)
    return decodeEntities("{{" + node.text + "}}");
  }

  /********************* utility methods ****************/

  /**
   * Does the content still contain block-level passthrough markup? The
   * same predicate ParagraphModule uses when setting the blockHtml flag,
   * re-evaluated after transforms (sanitization may have turned tags to
   * text).
   * @param {Array<*>} content
   * @returns {boolean}
   */
  containsBlockPassthrough(content) {
    for (const node of content) {
      if (node instanceof HtmlTagNode) {
        if (!node.closing && !inlineElements.has(node.name.toLowerCase())) {
          return true;
        }
      } else if (node instanceof HtmlElementNode) {
        // block element, or a transparent inline wrapper (<a>, <ins>,
        // ...) holding one
        if (!inlineElements.has(node.name.toLowerCase()) || this.containsBlockPassthrough(node.content.children)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Analyze paragraph content to determine what types of nodes it contains.
   * @param {Array<*>} content
   * @returns {{hasText: boolean, hasReplaced: boolean, hasMarkup: boolean, hasOther: boolean}}
   */
  analyzeContent(content) {
    let hasText = false;
    let hasReplaced = false;
    let hasMarkup = false;
    let hasBlock = false;
    let hasBreak = false;
    let hasOther = false;

    for (const node of content) {
      if (node instanceof TextNode) {
        hasText = hasText || phpTrim(node.text) !== "";
      } else if (node instanceof ImageNode) {
        hasReplaced = true;
      } else if (node instanceof HtmlCommentNode) {
        hasMarkup = true;
      } else if (node instanceof HtmlTagNode) {
        const inlineType = inlineElements.get(node.name.toLowerCase()) ?? null;
        if (inlineType === 1) {
          hasReplaced = true; // replaced element (img, br, input, ...)
        } else if (inlineType === 0) {
          hasMarkup = true; // inline markup (span, a, strong, ...)
        } else {
          hasMarkup = hasBlock = true; // block element
        }
      } else if (node instanceof HtmlElementNode) {
        const inlineType = inlineElements.get(node.name.toLowerCase()) ?? null;
        if (inlineType === 1) {
          hasReplaced = true; // replaced element (script, object, ...)
        } else if (inlineType === 0) {
          hasMarkup = true;
        } else {
          hasMarkup = hasBlock = true;
        }
        // the element's descendants count as content of the paragraph
        const inner = this.analyzeContent(node.content.children);
        hasText = hasText || inner.hasText;
        hasReplaced = hasReplaced || inner.hasReplaced;
        hasMarkup = hasMarkup || inner.hasMarkup;
        hasBlock = hasBlock || inner.hasBlock;
        hasBreak = hasBreak || inner.hasBreak;
        hasOther = hasOther || inner.hasOther;
      } else if (node instanceof LinkNode) {
        const inner = this.analyzeContent(node.content.children);
        if (inner.hasText || inner.hasOther) {
          hasOther = true;
        } else if (inner.hasReplaced) {
          hasReplaced = true;
        }
      } else if (node instanceof LineBreakNode) {
        hasBreak = true;
      } else {
        hasOther = true;
      }
    }

    return { hasText, hasReplaced, hasMarkup, hasBlock, hasBreak, hasOther };
  }

  /**
   * Wrap children in a null element (no tag wrapper).
   * @param {Array<Element|Raw|string>} children
   * @returns {Element}
   */
  wrapChildren(children) {
    const el = new Element(null);
    el.children = children;
    return el;
  }

  /**
   * @param {*} node
   * @returns {Element}
   */
  renderUnknown(node) {
    return this.wrapChildren(this.renderChildrenOf(node));
  }

  /**
   * Create paragraph for non-text content (images only).
   * @param {Array<Element|Raw|string>} children
   * @param {?import('../../Modifier.js').Modifier} modifier
   * @returns {Element}
   */
  createNontextParagraph(children, modifier) {
    const el =
      this.config.imageParagraphTag instanceof Element
        ? this.config.imageParagraphTag.clone()
        : new Element(this.config.imageParagraphTag);
    this.decorateElement(modifier, el);
    el.children = children;
    return el;
  }

  /**
   * Decorate element with modifier's classes, styles, and attributes.
   * @param {?import('../../Modifier.js').Modifier} modifier
   * @param {Element} el
   */
  decorateElement(modifier, el) {
    this.decorator.decorate(modifier, el);
  }
}
