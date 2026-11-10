/**
 * Render-tree HTML output primitives: Element attribute formatting and
 * the ElementDecorator policy behavior (the point where the security
 * policy meets author-written modifiers).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { All, HtmlPolicy } from "../src/HtmlPolicy.js";
import { Modifier } from "../src/Modifier.js";
import { Config } from "../src/Output/Html/Config.js";
import { Element } from "../src/Output/Html/Element.js";
import { ElementDecorator } from "../src/Output/Html/ElementDecorator.js";
import { Raw } from "../src/Output/Html/Raw.js";
import { UrlPolicy } from "../src/UrlPolicy.js";

describe("Element.formatAttrs", () => {
  it("skips null and false, keeps true as a boolean attribute", () => {
    assert.strictEqual(Element.formatAttrs({ a: null, b: false, c: true, d: "x" }), ' c d="x"');
  });

  it('escapes &"<>@ in values', () => {
    assert.strictEqual(Element.formatAttrs({ alt: 'a&b"c<d>e@f' }), ' alt="a&amp;b&quot;c&lt;d&gt;e&#64;f"');
  });

  it("freezes spaces so line wrapping cannot break inside the value", () => {
    assert.strictEqual(Element.formatAttrs({ title: "a b" }), ' title="a\x01b"');
  });

  it("joins class lists with spaces", () => {
    assert.strictEqual(Element.formatAttrs({ class: ["a", "b"] }), ' class="a\x01b"');
  });

  it("joins style maps with semicolons as prop:value pairs", () => {
    assert.strictEqual(
      Element.formatAttrs({ style: { float: "left", color: "red" } }),
      ' style="float:left;color:red"',
    );
  });

  it("skips zero-ish composite entries (PHP == null semantics) and empty composites", () => {
    assert.strictEqual(
      Element.formatAttrs({ class: ["a", "", "0", null], style: { color: "0", x: "y" } }),
      ' class="a" style="x:y"',
    );
  });

  it("serializes start and end tags; voids have no end tag", () => {
    const img = new Element("img", { src: "x" });
    assert.strictEqual(img.startTag(), '<img src="x">');
    assert.strictEqual(img.endTag(), "");

    const a = new Element("a", { href: "x" });
    a.children.push("Texy");
    assert.strictEqual(a.startTag() + a.children[0] + a.endTag(), '<a href="x">Texy</a>');
  });

  it("null name is a transparent wrapper with empty tags", () => {
    const wrap = new Element(null);
    wrap.add("x");
    assert.strictEqual(wrap.startTag(), "");
    assert.strictEqual(wrap.endTag(), "");
  });

  it("clone() deep-copies child elements but shares strings", () => {
    const el = new Element("div");
    const child = new Element("span");
    el.add(child).add("text");
    const copy = el.clone();
    copy.children[0].name = "b";
    assert.strictEqual(el.children[0].name, "span");
    assert.strictEqual(copy.children[1], "text");
  });
});

describe("ElementDecorator", () => {
  /**
   * @param {Object} options
   * @param {boolean|string[]} options.allowedClasses
   * @param {boolean|string[]} options.allowedStyles
   */
  function makeDecorator({ allowedClasses = All, allowedStyles = All } = {}) {
    const config = new Config();
    const policy = new HtmlPolicy(new UrlPolicy());
    policy.allowedClasses = allowedClasses;
    policy.allowedStyles = allowedStyles;
    const renderer = { postLineText: s => s };
    return new ElementDecorator(policy, policy.urlPolicy, config, renderer);
  }

  it("passes all classes and the id when the policy is All", () => {
    const d = makeDecorator();
    const mod = Modifier.parse("[foo bar #id]");
    const el = new Element("div");
    d.decorate(mod, el);
    assert.deepStrictEqual(el.attrs.class, ["foo", "bar"]);
    assert.strictEqual(el.attrs.id, "id");
  });

  it("filters classes to the whitelist and gates the id with #id", () => {
    const d = makeDecorator({ allowedClasses: ["bar", "#id"] });
    const mod = Modifier.parse("[foo bar #id]");
    const el = new Element("div");
    d.decorate(mod, el);
    assert.deepStrictEqual(el.attrs.class, ["bar"]);
    assert.strictEqual(el.attrs.id, "id");

    const el2 = new Element("div");
    const mod2 = Modifier.parse("[bar #other]");
    d.decorate(mod2, el2);
    assert.strictEqual(el2.attrs.id, undefined);
  });

  it("keeps no classes when the policy is None", () => {
    const d = makeDecorator({ allowedClasses: false });
    const el = new Element("div");
    d.decorate(Modifier.parse("[foo #id]"), el);
    assert.deepStrictEqual(el.attrs.class, []);
    assert.strictEqual(el.attrs.id, undefined);
  });

  it("filters styles to the whitelist", () => {
    const d = makeDecorator({ allowedStyles: ["color"] });
    const el = new Element("div");
    d.decorate(Modifier.parse("{color:red; float:left}"), el);
    assert.deepStrictEqual(el.attrs.style, { color: "red" });
  });

  it("maps hAlign/vAlign to text-align/vertical-align styles by default", () => {
    const d = makeDecorator();
    const el = new Element("p");
    d.decorate(Modifier.parse(">^"), el);
    assert.deepStrictEqual(el.attrs.style, { "text-align": "right", "vertical-align": "top" });
  });

  it("maps aligns to CSS classes when alignClasses are configured", () => {
    const d = makeDecorator();
    d.config.alignClasses.right = "r";
    const el = new Element("p");
    d.decorate(Modifier.parse(">"), el);
    assert.deepStrictEqual(el.attrs.class, ["r"]);
    assert.strictEqual(el.attrs.style, undefined);
  });

  it("replaces attrs with the policy-filtered modifier attrs", () => {
    const d = makeDecorator();
    const el = new Element("div", { "data-keep": "x" });
    el.attrs.src = null; // reserved by a renderer
    d.decorate(Modifier.parse("{title:T; href:index.html}"), el);
    assert.deepStrictEqual(Object.keys(el.attrs), ["title", "href"]);
  });

  it("drops URL attributes the UrlPolicy refuses, even on a permissive tag policy", () => {
    const d = makeDecorator();
    d.policy.urlPolicy.linkPattern = String.raw`~https?:~A`;

    // the {attr:value} grammar cannot express an URL with a colon, so
    // the modifier is built directly
    const bad = new Modifier();
    bad.attrs.href = "javascript:alert(1)";
    const el = new Element("a");
    d.decorate(bad, el);
    assert.strictEqual(el.attrs.href, undefined);

    const good = new Modifier();
    good.attrs.href = "https://x";
    const el2 = new Element("a");
    d.decorate(good, el2);
    assert.strictEqual(el2.attrs.href, "https://x");
  });

  it("applies the title modifier", () => {
    const d = makeDecorator();
    const el = new Element("p");
    d.decorate(Modifier.parse("(Hello)"), el);
    assert.strictEqual(el.attrs.title, "Hello");
  });

  it("applyFloat: side class, alignClasses fallback, then inline float style", () => {
    const d = makeDecorator();
    const el = new Element("img");
    d.applyFloat(el, "left", "il", "ir");
    assert.deepStrictEqual(el.attrs.class, ["il"]);

    const el2 = new Element("img");
    d.applyFloat(el2, "left", null, null);
    assert.deepStrictEqual(el2.attrs.style, { float: "left" });

    d.config.alignClasses.left = "al";
    const el3 = new Element("img");
    d.applyFloat(el3, "left", null, null);
    assert.deepStrictEqual(el3.attrs.class, ["al"]);
  });
});

describe("Raw", () => {
  it("holds the pre-serialized html", () => {
    assert.strictEqual(new Raw("<!-- x -->").html, "<!-- x -->");
  });
});
