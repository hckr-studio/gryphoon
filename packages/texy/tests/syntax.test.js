/**
 * Syntax-level parse tests, ported from the reference .phpt suite to AST
 * assertions (the HTML-rendering assertions of the original files map to
 * the AST constructs that produce them; rendering itself is out of scope).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findAll, findFirst } from "../src/NodeHelpers.js";
import {
  BlockQuoteNode,
  CodeBlockNode,
  CommentNode,
  DirectiveNode,
  EmailNode,
  EmoticonNode,
  FigureNode,
  HorizontalRuleNode,
  HtmlCommentNode,
  HtmlElementNode,
  HtmlTagNode,
  ImageDefinitionNode,
  ImageNode,
  LineBreakNode,
  LinkDefinitionNode,
  LinkNode,
  ListNode,
  PhraseNode,
  RawTextNode,
  SectionNode,
  TableNode,
  TextNode,
  UrlNode,
} from "../src/nodes.js";
import { Syntax } from "../src/Syntax.js";
import { Texy } from "../src/Texy.js";

function parse(text, { mergeLines = true, emoticon = false, allowed = {} } = {}) {
  const texy = new Texy();
  texy.paragraphModule.mergeLines = mergeLines;
  texy.allowed[Syntax.Typography] = false; // assertions are over the raw AST
  texy.allowed[Syntax.Hyphenation] = false;
  if (emoticon) texy.allowed.emoticon = true;
  Object.assign(texy.allowed, allowed);
  const document = texy.parse(text);
  texy.transform(document); // reference resolution runs in the transform phase now
  return document.content.children;
}

describe("phrases", () => {
  it("strong, emphasis, strong+em, code", () => {
    const [para] = parse("**bold** //italic// ***both*** `code`");
    const types = para.content.children.filter(n => n instanceof PhraseNode).map(n => n.type);
    assert.deepEqual(types, ["phrase/strong", "phrase/em", "phrase/strong+em", "phrase/code"]);
  });

  it("nested phrases", () => {
    const [para] = parse("**bold and //italic// text**");
    const strong = para.content.children[0];
    assert.equal(strong.type, "phrase/strong");
    const em = strong.content.children.find(n => n instanceof PhraseNode);
    assert.equal(em.type, "phrase/em");
  });

  it("phrase with modifier keeps the modifier", () => {
    const [para] = parse("**bold .[highlight]**");
    assert.deepEqual(Object.keys(para.content.children[0].modifier.classes), ["highlight"]);
  });

  it("phrase with link becomes a link wrapping the phrase", () => {
    const [para] = parse("**bold**:[http://texy.info]");
    const link = para.content.children[0];
    assert.ok(link instanceof LinkNode);
    assert.equal(link.url, "http://texy.info"); // [ref] resolution: no definition -> inner text as URL
    assert.equal(link.content.children[0].type, "phrase/strong");
  });

  it("span without modifier or link is refused", () => {
    const [para] = parse('"plain quoted text"');
    assert.ok(para.content.children[0] instanceof TextNode);
    const [para2] = parse('"span .[cls]"'); // the modifier sits inside the quotes
    assert.equal(para2.content.children[0].type, "phrase/span");
  });

  it("acronym and acronym-alt", () => {
    const [para] = parse("NATO((North Atlantic Treaty Organisation))");
    const node = para.content.children[0];
    assert.equal(node.type, "phrase/acronym-alt");
    assert.equal(node.modifier.title, "North Atlantic Treaty Organisation");
    assert.equal(node.content.children[0].text, "NATO");

    const [para2] = parse('"et al."((and others))');
    assert.equal(para2.content.children[0].type, "phrase/acronym");
  });

  it("alternative sup/sub: m^2, H_2O", () => {
    const [para] = parse("m^2 m_3");
    const sup = findFirst(para, n => n instanceof PhraseNode && n.type === "phrase/sup-alt");
    const sub = findFirst(para, n => n instanceof PhraseNode && n.type === "phrase/sub-alt");
    assert.equal(sup.content.children[0].text, "2");
    assert.equal(sub.content.children[0].text, "3");
  });

  it("inline code content is not parsed recursively", () => {
    const [para] = parse("`**literal**`");
    const code = para.content.children[0];
    assert.equal(code.content.children[0].text, "**literal**");
  });

  it("notexy is raw text", () => {
    const [para] = parse("''**raw**''");
    const raw = para.content.children[0];
    assert.ok(raw instanceof RawTextNode);
    assert.equal(raw.text, "**raw**");
  });

  it("escaped asterisk", () => {
    const [para] = parse("a \\* b");
    const texts = para.content.children.filter(n => n instanceof TextNode).map(n => n.text);
    assert.ok(texts.includes("*"));
  });

  it("disabled syntaxes are off by default", () => {
    const [para] = parse("++ins++ --del-- ^^sup^^ __sub__");
    assert.ok(para.content.children.every(n => n instanceof TextNode));
  });
});

describe("links", () => {
  it("quicklink word:[target]", () => {
    const [para] = parse("click:[target]");
    const link = para.content.children[0];
    assert.ok(link instanceof LinkNode);
    assert.equal(link.url, "target"); // [ref] resolution: no definition -> inner text as URL
  });

  it("wikilink [text |link]", () => {
    const [para] = parse("[text|link]");
    assert.equal(para.content.children[0].url, "link");
    assert.equal(para.content.children[0].content.children[0].text, "text");
  });

  it("markdown [text](link)", () => {
    const [para] = parse("[text](http://example.com)");
    assert.equal(para.content.children[0].url, "http://example.com");
  });

  it("autolinks", () => {
    const [para] = parse("see https://example.com/path or mail@example.com");
    const url = findFirst(para, n => n instanceof UrlNode);
    const email = findFirst(para, n => n instanceof EmailNode);
    assert.equal(url.url, "https://example.com/path");
    assert.equal(email.email, "mail@example.com");
  });

  it("link definitions are parsed as nodes", () => {
    const blocks = parse("[ref]: http://example.com");
    assert.ok(blocks[0] instanceof LinkDefinitionNode);
    assert.equal(blocks[0].reference, "ref");
    assert.equal(blocks[0].url, "http://example.com");
  });

  it("bare references are opt-in", () => {
    const [off] = parse("[ref]");
    assert.ok(off.content.children[0] instanceof TextNode);

    const [on] = parse("[ref]", { allowed: { "link/reference": true } });
    const link = on.content.children[0];
    assert.ok(link instanceof LinkNode);
    assert.equal(link.url, "ref"); // [ref] resolution: no definition -> inner text as URL
    assert.equal(link.ref, "ref");
  });
});

describe("images and figures", () => {
  it("image with dimensions", () => {
    const blocks = parse("[* img.jpg 100x200 *]");
    assert.ok(blocks[0] instanceof FigureNode); // a lone [*...*] line is a caption-less figure
    const image = blocks[0].image;
    assert.ok(image instanceof ImageNode);
    assert.equal(image.url, "img.jpg");
    assert.equal(image.width, 100);
    assert.equal(image.height, 200);
  });

  it("image modifier inside [* ... *] (alignment char abuts the bracket)", () => {
    const blocks = parse("[* img.jpg .(alt text)>]");
    const image = blocks[0].image;
    assert.equal(image.modifier.title, "alt text");
    assert.equal(image.modifier.hAlign, "right");
  });

  it("image with :link is wrapped in a LinkNode", () => {
    const blocks = parse("[* img.jpg *]:[http://big.jpg]");
    const figure = blocks[0];
    assert.ok(figure instanceof FigureNode);
    const link = figure.image;
    assert.ok(link instanceof LinkNode);
    assert.ok(link.content.children[0] instanceof ImageNode);
    assert.equal(link.url, "http://big.jpg"); // [ref] resolution
  });

  it("image with bare :: links to itself", () => {
    const blocks = parse("[* img.jpg *]::");
    const link = blocks[0].image;
    assert.equal(link.url, "img.jpg");
    assert.equal(link.isImageLink, true);
  });

  it("figure with caption", () => {
    const blocks = parse("[* img.jpg *] *** caption **bold**");
    const figure = blocks[0];
    assert.ok(figure instanceof FigureNode);
    assert.ok(figure.image instanceof ImageNode);
    const phrase = findFirst(figure.caption, n => n instanceof PhraseNode);
    assert.equal(phrase.type, "phrase/strong");
  });

  it("image definitions", () => {
    const blocks = parse("[* ref *]: img.jpg .(title)");
    assert.ok(blocks[0] instanceof ImageDefinitionNode);
    assert.equal(blocks[0].reference, "ref");
    assert.equal(blocks[0].url, "img.jpg");
  });
});

describe("headings", () => {
  it("surrounded heading", () => {
    const blocks = parse("### Title");
    assert.equal(blocks[0].type, "Surrounded");
    assert.equal(blocks[0].level, 1); // balanced: 4 + (top - min) = 1
    assert.equal(blocks[0].content.children[0].text, "Title");
  });

  it("underlined heading", () => {
    const blocks = parse("Title\n=====");
    assert.equal(blocks[0].type, "Underlined");
    assert.equal(blocks[0].level, 1); // balanced: rank('=') + top = 1
  });

  it("trailing marks are stripped from surrounded headings", () => {
    const blocks = parse("## Title ##");
    assert.equal(blocks[0].content.children[0].text, "Title");
  });
});

describe("lists", () => {
  it("unordered and ordered", () => {
    const blocks = parse("- one\n- two\n");
    assert.ok(blocks[0] instanceof ListNode);
    assert.equal(blocks[0].type, "ul");
    assert.equal(blocks[0].items.length, 2);

    const blocks2 = parse("1. one\n1. two\n");
    assert.equal(blocks2[0].type, "ol");
  });

  it("ordered start derived from the written marker", () => {
    const blocks = parse("3) three\n4) four\n");
    assert.equal(blocks[0].start, 3);
  });

  it("definition list", () => {
    const blocks = parse("term:\n - description\n");
    assert.ok(blocks[0].constructor.name === "DefinitionListNode");
    const items = blocks[0].items;
    assert.equal(items.length, 2);
    assert.ok(items[0].term);
    assert.ok(!items[1].term);
  });
});

describe("blocks", () => {
  it("/--code with language", () => {
    const blocks = parse("/--code js\nvar x;\n\\--");
    assert.ok(blocks[0] instanceof CodeBlockNode);
    assert.equal(blocks[0].type, "code");
    assert.equal(blocks[0].language, "js");
    assert.equal(blocks[0].code, "var x;");
  });

  it("/--div parses content as blocks", () => {
    const blocks = parse("/--div\ninner **text**\n\\--");
    const section = blocks[0];
    assert.ok(section instanceof SectionNode);
    assert.equal(section.type, "div");
    assert.ok(findFirst(section, n => n instanceof PhraseNode));
  });

  it("/--comment is a hidden comment", () => {
    const blocks = parse("/--comment\nsecret\n\\--");
    assert.ok(blocks[0] instanceof CommentNode);
  });

  it("unknown block type that is not a language is refused", () => {
    const blocks = parse("/--@@@\nrefused\n\\--");
    assert.ok(blocks[0].constructor.name === "ParagraphNode");
  });

  it("fenced code", () => {
    const blocks = parse("```js\nvar x = 1;\n```");
    const fence = findFirst({ getChildren: () => blocks }, n => n instanceof CodeBlockNode);
    assert.equal(fence.language, "js");
    assert.equal(fence.code, "var x = 1;");
  });

  it("fenced modifier trails the info string", () => {
    const blocks = parse("```js .{file: x.js}\nvar x;\n```");
    const fence = findFirst({ getChildren: () => blocks }, n => n instanceof CodeBlockNode);
    assert.equal(fence.language, "js");
    assert.equal(fence.modifier.styles.file, "x.js"); // unknown prop names are styles, not attrs
  });
});

describe("horizontal rule", () => {
  it("--- and ***", () => {
    const blocks = parse("---");
    assert.ok(blocks[0] instanceof HorizontalRuleNode);
    assert.equal(blocks[0].type, "-");
    const blocks2 = parse("***");
    assert.equal(blocks2[0].type, "*");
  });

  it("a paragraph line before --- parses as an underlined heading (leftmost wins)", () => {
    const blocks = parse("text\n---");
    assert.notEqual(blocks[0].constructor.name, "HorizontalRuleNode");
  });
});

describe("blockquotes", () => {
  it("basic quote with nested content", () => {
    const blocks = parse("> quoted **text**");
    const quote = blocks[0];
    assert.ok(quote instanceof BlockQuoteNode);
    assert.ok(findFirst(quote, n => n instanceof PhraseNode));
  });

  it("nested quotes via > >", () => {
    const blocks = parse("> > deep");
    const quote = blocks[0];
    const inner = findFirst(quote, n => n instanceof BlockQuoteNode);
    assert.ok(inner);
  });
});

describe("html", () => {
  it("tags, attributes, comments, entities", () => {
    const [para] = parse('<b class="x">bold</b> <!-- comment --> &amp; &#65;');
    const element = findFirst(para, n => n instanceof HtmlElementNode); // paired by the transform pass
    assert.equal(element.name, "b");
    assert.deepEqual(element.attributes, { class: "x" });
    assert.equal(findFirst(element, n => n instanceof TextNode).text, "bold");
    assert.ok(findFirst(para, n => n instanceof HtmlCommentNode));
    const texts = [...findAll(para, n => n instanceof TextNode)].map(n => n.text);
    assert.ok(texts.includes("&"));
    assert.ok(texts.includes("A"));
  });

  it("closing tag with attributes is refused", () => {
    const [para] = parse('</b class="x">');
    const texts = [...findAll(para, n => n instanceof TextNode)].map(n => n.text);
    assert.ok(texts.some(t => t.includes("</b")));
  });
});

describe("directives", () => {
  it("{{name: arg, arg}} parses with content", () => {
    const texy = new Texy();
    const doc = texy.parse("{{texy: nofollow}}");
    texy.transform(doc); // directives are consumed in the transform phase
    assert.equal(doc.meta.nofollow, true); // consumed into document meta
    assert.equal(
      findFirst(doc, n => n instanceof DirectiveNode),
      null,
    ); // and removed from the tree

    const [para] = parse("{{mydirective: arg1, arg2}}");
    const node = findFirst(para, n => n instanceof DirectiveNode); // unknown -> stays
    const parsed = node.parseContent();
    assert.equal(parsed.name, "mydirective");
    assert.deepEqual(parsed.args, ["arg1", "arg2"]);
  });

  it("empty directive is refused", () => {
    const [para] = parse("{{}}");
    assert.ok(para.content.children.every(n => n instanceof TextNode));
  });
});

describe("line breaks", () => {
  it("mergeLines=true: indented continuation line is a hard break", () => {
    const [para] = parse("first line\n second line");
    const breaks = [...findAll(para, n => n instanceof LineBreakNode)];
    assert.equal(breaks.length, 1);
  });

  it("mergeLines=true: plain lines merge to a space", () => {
    const [para] = parse("first line\nsecond line");
    assert.equal([...findAll(para, n => n instanceof LineBreakNode)].length, 0);
  });

  it("mergeLines=false: every newline is a break", () => {
    const [para] = parse("first line\nsecond line", { mergeLines: false });
    assert.equal([...findAll(para, n => n instanceof LineBreakNode)].length, 1);
  });
});

describe("emoticons", () => {
  it("off by default, opt-in", () => {
    const [off] = parse(":-)");
    assert.ok(off.content.children[0] instanceof TextNode);

    const [on] = parse(":-)", { emoticon: true });
    assert.ok(on.content.children[0] instanceof EmoticonNode);
    assert.equal(on.content.children[0].emoticon, ":-)");
    assert.equal(on.content.children[0].resolved, "\u{1F642}"); // filled by the transform pass
  });

  it("last char may repeat", () => {
    const [para] = parse(":-))", { emoticon: true });
    const node = para.content.children[0];
    assert.ok(node instanceof EmoticonNode);
    assert.equal(node.emoticon, ":-)");
    assert.equal(node.resolved, "\u{1F642}");
  });
});

describe("tables", () => {
  it("basic table with header row", () => {
    const blocks = parse("| a | b |\n|---|---|\n| 1 | 2 |");
    const table = blocks[0];
    assert.ok(table instanceof TableNode);
    assert.equal(table.rows.length, 2);
    assert.ok(table.rows[0].header);
    assert.ok(!table.rows[1].header);
  });

  it("caption line |## Text", () => {
    const blocks = parse("|## Caption\n| a |\n|---|");
    assert.equal(findFirst(blocks[0], n => n instanceof TextNode)?.text, "Caption");
  });

  it("rowspan and colspan arithmetic", () => {
    const blocks = parse("| a | b |\n| ^| 2 |");
    const table = blocks[0];
    // 'a' gets rowspan 2; 'b' extended by empty cell
    assert.equal(table.rows[0].cells[0].rowspan, 2);
  });
});
