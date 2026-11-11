/**
 * The translation of a Texy 3 production setup (blog-texy) into this
 * port's extension points:
 *
 *    Texy 3 addHandler('script', ...)  ->  texy.directiveModule.fallback
 *                                          (one handler dispatching on
 *                                          the directive name)
 *    Texy 3 addHandler('image', ...)   ->  texy.addPass over image nodes
 *    Texy 3 addHandler('block', ...)   ->   renderer.addRenderer(CodeBlockNode)
 *    Texy 3 $texy->protect(markup)    ->   HtmlElementNode (raw markup,
 *                                          attributes validated by the
 *                                          sanitize pass like passthrough)
 *    $texy->phraseModule->tags         ->  texy.htmlOutput.phraseTags
 *    $texy->figureModule->class        ->  texy.htmlOutput.figureClass
 *    $texy->headingModule->top         ->  texy.headingModule.top
 *    $texy->headingModule->generateID  ->  texy.headingModule.generateID
 *    $texy->imageModule->root          ->  texy.htmlOutput.imageRoot
 *    $texy->allowed['phrase/ins'] ...  ->  texy.allowed[Syntax.Inserted]
 *                                          etc. (ins/del/sup/sub are
 *                                          opt-in like the reference)
 *    $texy->allowedTags = true         ->  the htmlPolicy default
 *
 * Expected attribute sets verified against the PHP reference (the
 * Clojure sibling test); attribute order is the renderer's insertion
 * order (semantically irrelevant in HTML, sorted in the conformance
 * suite).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml } from "../src/helpers.js";
import { Modifier } from "../src/Modifier.js";
import { NodeTraverser } from "../src/NodeTraverser.js";
import { CodeBlockNode, HtmlElementNode, ImageNode, RawTextNode } from "../src/nodes.js";
import { Element } from "../src/Output/Html/Element.js";
import { Raw } from "../src/Output/Html/Raw.js";
import { Syntax } from "../src/Syntax.js";
import { Texy } from "../src/Texy.js";

/**
 * PHP rawurlencode: percent encoding of the RFC 3986 reserved set -
 * encodeURIComponent additionally leaves ! ' ( ) unencoded.
 * @param {string} s
 */
function rawUrlEncode(s) {
  return encodeURIComponent(s).replaceAll(/[!'()*]/g, ch => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * A player iframe as an AST html-element node: raw markup in the
 * output, its attributes validated by the sanitize pass like any
 * passthrough element (the Texy 3 $texy->protect equivalent).
 * @param {{src: string, width: string, height: string, cls: ?string,
 *          title: ?string, allow: ?string, allowfullscreen: ?boolean,
 *          dataRatio: ?string}} player
 */
function player({ src, width, height, cls, title, allow, allowfullscreen, dataRatio }) {
  return new HtmlElementNode("iframe", {
    loading: "lazy",
    width,
    height,
    ...(cls !== undefined ? { class: cls } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(allow !== undefined ? { allow } : {}),
    ...(allowfullscreen ? { allowfullscreen: "" } : {}),
    ...(dataRatio !== undefined ? { "data-ratio": dataRatio } : {}),
    src,
  });
}

/**
 * The Texy 3 scriptHandler: one fallback dispatching on the directive
 * name (the PHP switch), returning AST nodes instead of protected
 * strings. Unknown directives render as the author wrote them (the
 * PHP $invocation->proceed() default).
 * @param {import('../src/nodes.js').DirectiveNode} node
 */
function scriptHandler(node) {
  const { name, args } = node;
  const escaped = args.map(arg => escapeHtml(arg));

  switch (name) {
    case "mixcloud-mini":
      return player({
        src: `https://www.mixcloud.com/widget/iframe/?hide_cover=1&light=1&mini=1&feed=${rawUrlEncode(args[0])}&${escaped[1] ?? ""}`,
        width: "560",
        height: "60",
        cls: "player mixcloud-player mixcloud-player--mini",
      });

    case "mixcloud":
      return player({
        src: `https://www.mixcloud.com/widget/iframe/?hide_cover=1&light=1&feed=${rawUrlEncode(args[0])}&${escaped[1] ?? ""}`,
        width: "560",
        height: "120",
        cls: "player mixcloud-player",
      });

    case "speakerdeck":
      return player({
        src: `https://speakerdeck.com/player/${rawUrlEncode(args[0])}`,
        width: "560",
        height: "420",
        cls: "player speakerdeck",
        allowfullscreen: true,
        dataRatio: "1.3333333333333333",
      });

    case "spotify":
      return player({
        src: `https://open.spotify.com/embed/episode/${escaped[0]}`,
        width: "560",
        height: "152",
        cls: "player spotify-player",
        allowfullscreen: true,
        allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
      });

    case "youtube":
      return player({
        src: `https://www.youtube-nocookie.com/embed/${escaped[0]}`,
        width: "560",
        height: "315",
        cls: "player youtube-player",
        title: "YouTube video player",
        allowfullscreen: true,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      });

    default:
      return new RawTextNode(`{{${node.text}}}`); // proceed()
  }
}

/**
 * The Texy 3 image handler: every image gets loading=lazy and
 * sizes=100vw (Client Hints) - a transform pass over image nodes,
 * riding the modifier-attribute path so the values land on the <img>.
 * @param {import('../src/nodes.js').DocumentNode} document
 */
function imageHandlerPass(document) {
  new NodeTraverser().traverse(document, node => {
    if (node instanceof ImageNode) {
      node.modifier ??= new Modifier();
      node.modifier.attrs.loading = "lazy";
      node.modifier.attrs.sizes = "100vw";
    }
    return null;
  });
}

/**
 * The Texy 3 block handler as a renderer override: Prism.js wants
 * language-<lang> on the <code> element and no language class on the
 * <pre>.
 * @param {Texy} texy
 */
function prismRenderer(texy) {
  const renderer = texy.createHtmlRenderer();
  renderer.addRenderer(CodeBlockNode, (node, self, previous) => {
    if (!node.language) {
      return previous(node); // proceed()
    }

    const pre = new Element("pre");
    pre.create("code", { class: `language-${node.language}` }).add(new Raw(escapeHtml(node.code)));
    return pre;
  });
  return renderer;
}

/**
 * @returns {Texy}
 */
function blogTexy() {
  const texy = new Texy();

  texy.allowed[Syntax.Inserted] = true;
  texy.allowed[Syntax.Deleted] = true;
  texy.allowed[Syntax.Superscript] = true;
  texy.allowed[Syntax.Subscript] = true;

  texy.headingModule.top = 3;
  texy.headingModule.generateID = true;
  texy.htmlOutput.figureTag = "div"; // the Texy 3-style layout of this blog
  texy.htmlOutput.figureClass = "image";
  texy.htmlOutput.imageBaseUrl =
    "https://res.cloudinary.com/rarous/image/fetch/dpr_auto,f_auto,q_auto,w_auto:100:800/https://www.rarous.net/data/obrazky/";
  texy.htmlOutput.phraseTags[Syntax.Emphasis] = "i"; // phrase/em -> <i>

  // flat output: indent and line wrap off (the reference probes'
  // htmlOutput->indent = false; htmlOutput->lineWrap = 0), so the
  // expectations stay diff-able against the oracle strings
  texy.htmlOutput.indent = false;
  texy.htmlOutput.lineWrap = 0;

  texy.directiveModule.fallback = scriptHandler;
  texy.addPass(imageHandlerPass);

  return texy;
}

describe("blog-texy setup", () => {
  it("youtube: raw iframe, nontext <div> wrapper (an iframe is inline-replaced content)", () => {
    assert.equal(
      blogTexy().process("{{youtube(dQw4w9WgXcQ)}}"),
      '<div><iframe loading="lazy" width="560" height="315" class="player youtube-player" ' +
        'title="YouTube video player" ' +
        'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
        'allowfullscreen="" ' +
        'src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe></div>',
    );
  });

  it("mixcloud-mini with feed and extra params (& escapes in attributes)", () => {
    assert.equal(
      blogTexy().process("{{mixcloud-mini(/webmaraton/, autoplay=1)}}"),
      '<div><iframe loading="lazy" width="560" height="60" class="player mixcloud-player mixcloud-player--mini" ' +
        'src="https://www.mixcloud.com/widget/iframe/?hide_cover=1&amp;light=1&amp;mini=1&amp;feed=%2Fwebmaraton%2F&amp;autoplay=1"></iframe></div>',
    );
  });

  it("an unknown directive proceeds (renders literally)", () => {
    assert.equal(blogTexy().process("{{unknown(1)}}"), "<p>{{unknown(1)}}</p>");
  });

  it("every image gets loading=lazy and sizes=100vw on the cloudinary root, figure class from config", () => {
    assert.equal(
      blogTexy().process("[* photo.jpg *]"),
      '<div class="image"><img ' +
        'src="https://res.cloudinary.com/rarous/image/fetch/dpr_auto,f_auto,q_auto,w_auto:100:800/https://www.rarous.net/data/obrazky/photo.jpg" alt="" loading="lazy" sizes="100vw"></div>',
    );
  });

  it("phrase/em renders as <i> (//Idiomatic text//)", () => {
    assert.equal(blogTexy().process("//Idiomatic text//"), "<p><i>Idiomatic text</i></p>");
  });

  it("top heading level 3 with generated ids", () => {
    assert.equal(blogTexy().process("Title\n===="), '<h3 id="toc-title">Title</h3>');
  });

  it("Prism language class on <code>, none on <pre> (renderer override)", () => {
    const texy = new Texy();
    texy.allowed[Syntax.Typography] = false;
    texy.htmlOutput.indent = false;
    texy.htmlOutput.lineWrap = 0;
    assert.equal(
      prismRenderer(texy).render(texy.parse("```clojure\n(def x 1)\n```")),
      '<pre><code class="language-clojure">(def x 1)</code></pre>',
    );
  });

  it("the block renderer override passes non-code blocks to the built-in renderer", () => {
    const texy = new Texy();
    texy.allowed[Syntax.Typography] = false;
    texy.htmlOutput.indent = false;
    texy.htmlOutput.lineWrap = 0;
    assert.equal(
      prismRenderer(texy).render(texy.parse("```js\nvar 1;\n```")),
      '<pre><code class="language-js">var 1;</code></pre>',
    );
  });
});
