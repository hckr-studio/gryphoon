/**
 * Configuration of the HTML output (port of Texy\Output\Html\Config):
 * formatting and presentation options and user node renderers, exposed as
 * $texy.htmlOutput. Consumed by the Renderer and the WellFormer engine.
 */

import { Syntax } from "../../Syntax.js";

export class Config {
  constructor() {
    /** indent HTML code? */
    this.indent = true;

    /** @type {string[]} tags whose content keeps its whitespace verbatim */
    this.preserveSpaces = ["textarea", "pre", "script", "code", "samp", "kbd"];

    /** base indent level */
    this.baseIndent = 0;

    /** wrap width, doesn't include indent space */
    this.lineWrap = 80;

    /** @type {Object<string, ?string>} classes in place of style="text-align" */
    this.textAlignClasses = {
      left: null,
      right: null,
      center: null,
      justify: null,
    };

    /** @type {Object<string, ?string>} classes in place of style="vertical-align", null keeps the style */
    this.verticalAlignClasses = {
      top: null,
      middle: null,
      bottom: null,
    };

    /** @type {Object<string, ?string>} classes in place of style="float" of images and figures, null keeps the style */
    this.floatClasses = {
      left: null,
      right: null,
    };

    /** Do obfuscate e-mail addresses? */
    this.obfuscateEmail = true;

    /** element in place of <p> for a paragraph holding images only */
    this.imageParagraphTag = "div";

    /** Shorten URLs to more readable form? */
    this.shortenUrls = true;

    /** CSS class for emoticons */
    this.emoticonClass = null;

    /** element wrapping an image with its caption; <figure> puts the caption in <figcaption>, other elements in <p> */
    this.figureTag = "figure";

    /** class of every figure; a floated one gets the class of its float too */
    this.figureClass = null;

    /** @type {Object<string, ?string>} default CSS class for HR types */
    this.horizontalRuleClasses = {
      "-": null,
      "*": null,
    };

    /** Pass HTML comments to output? */
    this.passHtmlComments = true;

    /** base URL prepended to relative image URLs */
    this.imageBaseUrl = null;

    /**
     * base path of the image files on disk, where the dimensions of an
     * image are read from (the reference probes images with
     * getimagesize() under this root).
     */
    this.imageBasePath = null;

    /** Always use rel="nofollow" for absolute links? */
    this.linkNoFollow = false;

    /** base URL prepended to relative link URLs */
    this.linkBaseUrl = null;

    /** @type {Object<string, string>} syntax id -> HTML tag mapping; Emphasis covers *text* as well, Superscript and Subscript their short forms */
    this.phraseTags = {
      [Syntax.Strong]: "strong",
      [Syntax.Emphasis]: "em",
      [Syntax.Inserted]: "ins",
      [Syntax.Deleted]: "del",
      [Syntax.Superscript]: "sup",
      [Syntax.Subscript]: "sub",
      [Syntax.SpanQuotes]: "span",
      [Syntax.SpanTilde]: "span",
      [Syntax.Abbreviation]: "abbr",
      [Syntax.Code]: "code",
      [Syntax.Quote]: "q",
      [Syntax.QuickLink]: "a",
    };

    /** @type {Array<Function>} user node renderers (see addRenderer) */
    this.userRenderers = [];
  }

  /**
   * Registers how a node class is rendered. Return null to pass the node
   * on to the previous renderer for that class.
   *
   * Deviation from the reference (which reads the node class from the
   * first parameter's type hint): JavaScript has no runtime parameter
   * types, so the node class is passed explicitly.
   * @param {Function} nodeClass a Node subclass
   * @param {Function} renderer fn(node, rendererInstance, previousRenderer): Element|Raw|string|null
   */
  addRenderer(nodeClass, renderer) {
    this.userRenderers.push([nodeClass, renderer]);
  }

  /**
   * @internal
   * @returns {Array<[Function, Function]>}
   */
  getRenderers() {
    return this.userRenderers;
  }
}
