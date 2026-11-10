/**
 * Minimal parser engine - handles pattern registration and parsing (port of
 * Texy\Parsing\Engine).
 *
 * The pattern maps are a cumulative registry: re-registration under an
 * existing name replaces the handler and pattern but keeps the original
 * position, and nothing is ever removed. The allowed filter is applied per
 * parse when the parse context is created.
 *
 * Input contract: valid UTF-8, LF line endings, no \r (it is the internal
 * hard-break marker). Plain text between matches becomes TextNode holding
 * the source text verbatim; decoding (e.g. HTML entities) is a language
 * concern expressed as a registered syntax, never engine mechanics.
 *
 * Offsets are UTF-16 code-unit indices (see src/Range.js).
 */

import { ContentNode, DocumentNode } from "../nodes.js";
import { compile, match } from "../Regexp.js";
import { Stage } from "../Stage.js";
import { BlockParser } from "./BlockParser.js";
import { InlineParser } from "./InlineParser.js";
import { ParseContext } from "./ParseContext.js";

export class Engine {
  constructor() {
    /** @type {Map<string, {handler: Function, pattern: string}>} ordered */
    this.linePatterns = new Map();

    /** @type {Map<string, {handler: Function, pattern: string}>} ordered */
    this.blockPatterns = new Map();

    /** @type {Function} (context, text, offset) => BlockNode[] */
    this.gapHandler = () => [];

    /** @type {Object<string, Function[]>} passes of each stage, in registration order */
    this.passes = { [Stage.Syntax]: [], [Stage.Transform]: [], [Stage.Finalize]: [] };
  }

  /**
   * Register an inline pattern handler. The pattern is compiled once here;
   * the hot path then matches the compiled object without cache lookups.
   * @param {string} name
   * @param {string} pattern PCRE pattern with delimiters
   * @param {Function} handler (context, matches, offsets, name) => InlineNode|ContentNode|null
   */
  addLineSyntax(name, pattern, handler) {
    this.linePatterns.set(name, { handler, pattern, compiled: compile(pattern) });
  }

  /**
   * Register a block pattern handler. Patterns are forced multiline.
   * @param {string} name
   * @param {string} pattern PCRE pattern with delimiters
   * @param {Function} handler (context, matches, offsets, name) => BlockNode|ContentNode|null
   */
  addBlockSyntax(name, pattern, handler) {
    this.blockPatterns.set(name, { handler, pattern: pattern + "m", compiled: compile(pattern + "m") });
  }

  /**
   * Sets the gap handler for content between block patterns.
   * @param {Function} handler (context, text, offset) => BlockNode[]
   */
  setGapHandler(handler) {
    this.gapHandler = handler;
  }

  /**
   * Registers a pass: fn(DocumentNode): void. Passes of a stage run in
   * registration order.
   * @param {Function} pass
   * @param {string} stage one of Stage
   */
  addPass(pass, stage = Stage.Transform) {
    this.passes[stage].push(pass);
  }

  /**
   * Parse text into an AST, including the Syntax passes.
   * @param {string} text normalized source
   * @param {Object<string, boolean>} allowedSyntaxes map of syntax name => enabled
   * @param {boolean} singleLine parse as single line (inline only)
   * @returns {DocumentNode}
   */
  parse(text, allowedSyntaxes, singleLine = false) {
    const context = this.createParseContext(allowedSyntaxes);
    const content = singleLine ? context.parseInline(text) : context.parseBlock(text);

    const document = new DocumentNode(content);
    this.runPasses(document, Stage.Syntax);
    return document;
  }

  /**
   * Does the pattern of an allowed block syntax match the text? Its handler
   * could still refuse it.
   * @param {string} text
   * @param {Object<string, boolean>} allowedSyntaxes
   * @returns {boolean}
   */
  matchesBlockSyntax(text, allowedSyntaxes) {
    for (const [name, info] of this.blockPatterns) {
      if (allowedSyntaxes[name] && match(text, info.pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Runs the Transform and Finalize passes over a parsed document, changing
   * it in place. A document is transformed once; further calls do nothing.
   * @param {DocumentNode} document
   */
  transform(document) {
    if (!document.meta.transformed) {
      document.meta.transformed = true;
      this.runPasses(document, Stage.Transform);
      this.runPasses(document, Stage.Finalize);
    }
  }

  /** @param {DocumentNode} document @param {string} stage */
  runPasses(document, stage) {
    for (const pass of this.passes[stage]) {
      pass(document);
    }
  }

  /**
   * Creates a parse context with patterns filtered by the allowed map.
   * @param {Object<string, boolean>} allowedSyntaxes
   * @returns {ParseContext}
   */
  createParseContext(allowedSyntaxes) {
    return new ParseContext(this.createInlineParser(allowedSyntaxes), this.createBlockParser(allowedSyntaxes));
  }

  /** @param {Object<string, boolean>} allowedSyntaxes */
  createBlockParser(allowedSyntaxes) {
    const patterns = new Map();
    for (const [name, info] of this.blockPatterns) {
      if (allowedSyntaxes[name]) patterns.set(name, info);
    }
    return new BlockParser(patterns, this.gapHandler);
  }

  /** @param {Object<string, boolean>} allowedSyntaxes */
  createInlineParser(allowedSyntaxes) {
    const patterns = new Map();
    for (const [name, info] of this.linePatterns) {
      if (allowedSyntaxes[name]) patterns.set(name, info);
    }
    return new InlineParser(patterns);
  }
}
