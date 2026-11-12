/**
 * Texy! - text-to-HTML converter (port of Texy\Texy).
 *
 * Implements the full pipeline of the reference implementation (see
 * docs/porting.md): normalize -> parse -> transform passes (incl.
 * typography and hyphenation) -> HTML rendering. Typography substitutions
 * live in ./Typography.js (the reference pattern catalog over the
 * TextRunPass marker alphabet).
 *
 * <code>
 * const texy = new Texy();
 * const html = texy.process(text);          // text -> HTML
 * const document = texy.parse(text);        // text -> DocumentNode
 * const html2 = texy.renderHtml(document);   // DocumentNode -> HTML
 * const plain = texy.toText(text);           // text -> plain text
 * </code>
 */

import { HtmlPolicy } from "./HtmlPolicy.js";
import { LintCollector } from "./Lint.js";
import { AutolinkModule } from "./Modules/AutolinkModule.js";
import { BlockModule } from "./Modules/BlockModule.js";
import { BlockQuoteModule } from "./Modules/BlockQuoteModule.js";
import { DirectiveModule } from "./Modules/DirectiveModule.js";
import { EmoticonModule } from "./Modules/EmoticonModule.js";
import { HeadingModule } from "./Modules/HeadingModule.js";
import { HorizontalRuleModule } from "./Modules/HorizontalRuleModule.js";
import { HtmlModule } from "./Modules/HtmlModule.js";
import { HyphenationModule } from "./Modules/HyphenationModule.js";
import { ImageModule } from "./Modules/ImageModule.js";
import { LinkReferenceModule } from "./Modules/LinkReferenceModule.js";
import { ListModule } from "./Modules/ListModule.js";
import { ParagraphModule } from "./Modules/ParagraphModule.js";
import { PhraseModule } from "./Modules/PhraseModule.js";
import { TableModule } from "./Modules/TableModule.js";
import { TypographyModule } from "./Modules/TypographyModule.js";
import { normalize } from "./normalize.js";
import { Config } from "./Output/Html/Config.js";
import { Renderer } from "./Output/Html/Renderer.js";
import { Renderer as TextRenderer } from "./Output/Text/Renderer.js";
import { Engine } from "./Parsing/Engine.js";
import { TextRunPass } from "./Passes/TextRunPass.js";
import { HeadingPass } from "./Passes/HeadingPass.js";
import { Stage } from "./Stage.js";
import { Syntax } from "./Syntax.js";
import { UrlPolicy } from "./UrlPolicy.js";

export class Texy {
  constructor() {
    /** @type {Object<string, boolean>} Texy! syntax configuration */
    this.allowed = {};

    /** URL scheme security policy for links and images */
    this.urlPolicy = new UrlPolicy();

    /** @type {Array<import('./Modules/Module.js').Module>} */
    this.modules = [];

    /**
     * The parsing engine - a cumulative pattern registry. Modules refresh
     * their patterns before each parse; consumer registrations are never
     * overwritten.
     */
    this.engine = new Engine();

    /** @type {Object<string, true>} syntax names registered by the consumer */
    this.consumerSyntaxes = { line: {}, block: {} };

    this.inModulePrepare = false;

    /**
     * The transient lint issue collector while transform() runs: passes
     * read it (texy.lintCollector), it never changes the output. null
     * outside lint().
     * @type {?LintCollector}
     */
    this.lintCollector = null;

    /** HTML security policy: allowed tags, classes and inline styles */
    this.htmlPolicy = new HtmlPolicy(this.urlPolicy);

    /** @type {import('./Output/Html/Config.js').Config} HTML output configuration (formatting, presentation options) */
    this.htmlOutput = new Config();

    // module handles for configuration before parse
    this.paragraphModule = null;
    this.imageModule = null;
    this.linkModule = null;
    this.phraseModule = null;
    this.emoticonModule = null;
    this.headingModule = null;
    this.listModule = null;
    this.directiveModule = null;
    this.typographyModule = null;
    this.hyphenationModule = null;
    this.htmlModule = null;

    this.loadModules();
    // the passes of a document in any language, registered in one place so
    // that their order cannot differ between languages; they go after the
    // passes finishing the meaning of the language (the reference
    // Passes\DocumentPasses)
    this.engine.addPass(doc => this.htmlModule.processPassthrough(doc));
    this.engine.addPass(
      doc =>
        new HeadingPass(
          this.headingModule.top,
          this.headingModule.generateID,
          this.headingModule.idPrefix,
        ).process(doc),
    );
    this.engine.addPass(document => this.applyAstTypography(document), Stage.Finalize);
    this.engine.setGapHandler((context, gapText, offset) => this.paragraphModule.parseText(context, gapText, offset));
  }

  /**
   * Creates the array of all used modules. This array can be changed by
   * overriding this method (by subclasses). Registration order is part of
   * the collision-resolution contract.
   */
  loadModules() {
    // line parsing
    this.addModule((this.directiveModule = new DirectiveModule(this)));
    this.addModule((this.htmlModule = new HtmlModule(this)));
    this.addModule((this.imageModule = new ImageModule(this)));
    this.addModule((this.phraseModule = new PhraseModule(this)));
    this.addModule((this.linkModule = new LinkReferenceModule(this)));
    this.addModule(new AutolinkModule(this));
    this.addModule((this.emoticonModule = new EmoticonModule(this)));

    // block parsing
    this.addModule((this.paragraphModule = new ParagraphModule(this)));
    this.addModule(new BlockModule(this));
    this.addModule(new HorizontalRuleModule(this));
    this.addModule(new BlockQuoteModule(this));
    this.addModule(new TableModule(this));
    this.addModule((this.headingModule = new HeadingModule(this)));
    this.addModule((this.listModule = new ListModule(this)));

    // post process
    this.addModule((this.typographyModule = new TypographyModule(this)));
    this.addModule((this.hyphenationModule = new HyphenationModule(this)));
  }

  /**
   * @param {import('./Modules/Module.js').Module} module
   */
  addModule(module) {
    this.modules.push(module);
  }

  /**
   * Registers an inline syntax.
   * @param {string} name
   * @param {string} pattern PCRE pattern
   * @param {Function} handler (context, matches, offsets, name) => InlineNode|ContentNode|null
   */
  addInlineSyntax(name, pattern, handler) {
    if (this.inModulePrepare) {
      if (this.consumerSyntaxes.line[name]) return; // a syntax registered by the consumer is never overwritten by a module
    } else {
      this.consumerSyntaxes.line[name] = true;
    }

    if (this.allowed[name] === undefined) {
      this.allowed[name] = true;
    }

    this.engine.addInlineSyntax(name, pattern, handler);
  }

  /**
   * Registers a block syntax.
   * @param {string} name
   * @param {string} pattern PCRE pattern
   * @param {Function} handler (context, matches, offsets, name) => BlockNode|ContentNode|null
   */
  addBlockSyntax(name, pattern, handler) {
    if (this.inModulePrepare) {
      if (this.consumerSyntaxes.block[name]) return;
    } else {
      this.consumerSyntaxes.block[name] = true;
    }

    if (this.allowed[name] === undefined) {
      this.allowed[name] = true;
    }

    this.engine.addBlockSyntax(name, pattern, handler);
  }

  /**
   * Parses text to an AST. The text is normalized first (idempotent).
   * @param {string} text
   * @returns {import('./nodes.js').DocumentNode}
   */
  parse(text) {
    this.prepareModules();

    // the Syntax passes run inside the engine's parse()
    return this.engine.parse(normalize(text), this.allowed);
  }

  /**
   * Parses one line of text to the syntax tree: inline syntaxes only, no blocks.
   * @param {string} text
   * @returns {import('./nodes.js').DocumentNode}
   */
  parseLine(text) {
    this.prepareModules();
    return this.engine.parse(normalize(text), this.allowed, true);
  }

  /** The upstream name of parseLine(). */
  parseInline(text) {
    return this.parseLine(text);
  }

  /**
   * Does the text read as block markup as opposed to plain paragraph text?
   * @param {string} text
   * @returns {boolean}
   */
  readsAsBlock(text) {
    this.prepareModules();
    return this.engine.matchesBlockSyntax(normalize(text), this.allowed);
  }

  /**
   * Lets modules do per-parse initialization (pattern registration, state reset).
   */
  prepareModules() {
    this.inModulePrepare = true;
    try {
      for (const module of this.modules) {
        module.beforeParse();
      }
    } finally {
      this.inModulePrepare = false;
    }
  }

  /**
   * Turns the syntax tree into the document: resolves references, balances
   * headings, sanitizes HTML, applies typography and the consumer's passes.
   * Changes the tree in place; a document is transformed only once, and
   * returns it, so tx.transform(tx.parse(text)) is one expression.
   * @param {import('./nodes.js').DocumentNode} document
   * @param {?LintCollector} lintCollector optional issue collector; never changes the output
   * @returns {import('./nodes.js').DocumentNode}
   */
  transform(document, lintCollector = null) {
    try {
      this.lintCollector = lintCollector;
      this.engine.transform(document);
    } finally {
      this.lintCollector = null;
    }
    return document;
  }

  /**
   * Parses and transforms text and collects lint issues alongside the
   * document, so a consumer (e.g. a language server) gets both in one
   * pipeline run. Collection is passive - the collector never changes the
   * output.
   * @param {string} text
   * @returns {{ document: import('./nodes.js').DocumentNode, issues: Array<import('./Lint.js').LintIssue> }}
   */
  lint(text) {
    const collector = new LintCollector();
    const document = this.parse(text);
    this.transform(document, collector);
    return { document, issues: collector.issues };
  }

  /**
   * Runs typography/hyphenation over the AST, honouring the allowed[]
   * configuration, and marks the document so the renderer skips its
   * string post-processing (title/alt typography).
   *
   * parse() does this itself as its last step. It is public for the other
   * case: a document built by a different parser, which is still an
   * ordinary Texy AST and still wants the typography. Calling it on an
   * already typographed document does nothing.
   * @param {import('./nodes.js').DocumentNode} document
   */
  applyAstTypography(document) {
    if (document.meta.typographed) {
      return;
    }

    const transformers = [];
    if (this.allowed[Syntax.Typography]) {
      transformers.push(s => this.typographyModule.postLine(s));
    }
    if (this.allowed[Syntax.Hyphenation]) {
      transformers.push(s => this.hyphenationModule.postLine(s));
    }

    new TextRunPass(
      transformers,
      this.allowed[Syntax.Typography] ? s => this.typographyModule.postLine(s) : null,
    ).process(document);

    document.meta.typographed = true;
  }

  /**
   * Registers a consumer transform pass: fn(DocumentNode): void, called with
   * the whole document in transform(), in registration order.
   * @param {Function} pass
   * @param {string} stage one of Stage
   */
  addPass(pass, stage = Stage.Transform) {
    this.engine.addPass(pass, stage);
  }

  /**
   * Creates a parse context. Modules must be initialized via parse() first
   * for patterns to be available.
   */
  createParseContext() {
    return this.engine.createParseContext(this.allowed);
  }

  /**
   * Converts Texy text to HTML.
   * @param {string} text
   * @returns {string}
   */
  process(text) {
    return this.renderHtml(this.transform(this.parse(text)));
  }

  /** The upstream name of process(). */
  toHtml(text) {
    return this.process(text);
  }

  /**
   * Converts one line of Texy text to HTML: inline markup only, no paragraph around it.
   * @param {string} text
   * @returns {string}
   */
  processLine(text) {
    return this.renderHtml(this.transform(this.parseLine(text)));
  }

  /** The upstream name of processLine(). */
  toInlineHtml(text) {
    return this.processLine(text);
  }

  /**
   * Renders a parsed document to HTML. Separate from parse() so a
   * consumer can read or transform the AST in between.
   * @param {import('./nodes.js').DocumentNode} document
   * @returns {string}
   */
  renderHtml(document) {
    return this.createHtmlRenderer().render(document);
  }

  /**
   * Renders a parsed document onto a linkedom Document (content in
   * <body>) for DOM-side transformation; serialize afterwards via
   * linkedom (e.g. document.body.innerHTML).
   * @param {import('./nodes.js').DocumentNode} document
   * @returns the linkedom Document
   */
  renderDom(document) {
    return this.createHtmlRenderer().renderToDom(document);
  }

  /**
   * Creates an HTML renderer wired to the current configuration. The
   * renderer needs no live Texy instance and is reusable across documents.
   * @returns {Renderer}
   */
  createHtmlRenderer() {
    return new Renderer(
      this.htmlOutput,
      this.htmlPolicy,
      this.urlPolicy,
      this.allowed[Syntax.Typography] ? s => this.typographyModule.postLine(s) : null,
    );
  }

  /**
   * Makes only typographic corrections (and hyphenation), honouring the
   * allowed[] configuration.
   * @param {string} text
   * @returns {string}
   */
  applyTypography(text) {
    text = normalize(text);

    if (this.allowed[Syntax.Typography]) {
      text = this.typographyModule.postLine(text, true);
    }

    if (this.allowed[Syntax.Hyphenation]) {
      text = this.hyphenationModule.postLine(text);
    }

    return text;
  }

  /**
   * Converts Texy text to a plain-text rendition.
   * @param {string} text
   * @returns {string}
   */
  toText(text) {
    const document = this.parse(text);
    this.transform(document);
    return this.renderText(document);
  }

  /**
   * Renders a parsed document to plain text.
   * @param {import('./nodes.js').DocumentNode} document
   * @returns {string}
   */
  renderText(document) {
    return new TextRenderer().render(document);
  }
}
