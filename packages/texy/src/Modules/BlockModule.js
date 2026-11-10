/**
 * Processes special blocks (/-- code, html, text, div, etc.) and GFM fenced
 * code (port of Texy\Modules\BlockModule).
 */

import { Modifier } from "../Modifier.js";
import { CodeBlockNode, CommentNode, SectionNode } from "../nodes.js";
import { OffsetMap } from "../Parsing/OffsetMap.js";
import { ModifierHAlign, Modifier as ModifierPattern } from "../Patterns.js";
import { match, split } from "../Regexp.js";
import { Syntax } from "../Syntax.js";
import { Module } from "./Module.js";

const bt = String.fromCharCode(96); // backtick; cannot appear literally in these sources

/** The ```language fenced-code pattern (built by concatenation; %%BT%% is the fence). */
const fencedPattern = (
  "~^\n" +
  "(%%BT%%{3,}) [ \\t]*+                     # opening fence (1)\n" +
  "([^\\n%%BT%%]*)                           # info string (2)\n" +
  "$\n" +
  "((?: \\n (?! \\1 %%BT%%*+ [ \\t]*+ $ ) .*+ )*) # content (3): lines that are not a valid closing fence\n" +
  "(?:\n" +
  "\\n \\1 %%BT%%*+ [ \\t]*+ $ |           # closing fence (same length or longer)\n" +
  "\\z                              # or end of input\n" +
  ")\n" +
  "~mx"
).replaceAll("%%BT%%", bt);

export class BlockModule extends Module {
  constructor(texy) {
    super();
    this.texy = texy;
    texy.allowed[Syntax.BlockDefault] = true;
    texy.allowed[Syntax.BlockPre] = true;
    texy.allowed[Syntax.BlockCode] = true;
    texy.allowed[Syntax.BlockHtml] = true;
    texy.allowed[Syntax.BlockText] = true;
    texy.allowed[Syntax.BlockTexySource] = true;
    texy.allowed[Syntax.BlockComment] = true;
    texy.allowed[Syntax.BlockDiv] = true;
    texy.allowed[Syntax.CodeFenced] = true;
  }

  beforeParse() {
    this.texy.addBlockSyntax(
      Syntax.Blocks,
      String.raw`~^` +
        "\n" +
        String.raw`				/--++ [ \t]*+                 # opening tag /--` +
        "\n" +
        String.raw`				(.*)                          # content type (1)` +
        "\n" +
        ModifierHAlign +
        String.raw`? # modifier (2)` +
        "\n" +
        String.raw`				$` +
        "\n" +
        String.raw`				((?:                         # content (3)` +
        "\n" +
        String.raw`					\n (?0) |                # recursive nested blocks` +
        "\n" +
        String.raw`					\n.*+                    # or any content` +
        "\n" +
        String.raw`				)*)` +
        "\n" +
        String.raw`				(?:` +
        "\n" +
        String.raw`					\n \\--.* $ |           # closing tag` +
        "\n" +
        String.raw`					\z                       # or end of input` +
        "\n" +
        String.raw`				)` +
        "\n" +
        String.raw`			~mUix`,
      (context, matches, offsets) => this.parse(context, matches, offsets),
    );

    // ```language
    this.texy.addBlockSyntax(Syntax.CodeFenced, fencedPattern, (context, matches, offsets) =>
      this.parseFenced(context, matches, offsets),
    );
  }

  /**
   * Parses ```language fenced code blocks; content is verbatim.
   */
  parseFenced(context, matches, offsets) {
    let [, , mInfo, mContent] = matches;

    // a Texy modifier may trail the info string: ```php .{file: Foo.php}
    let mod = null;
    const m = match(mInfo, "~" + ModifierPattern + "$~x", { offset: 0 });
    if (m) {
      mod = Modifier.parse(m.matches[1], offsets[2] + m.offsets[1]);
      mInfo = mInfo.slice(0, m.offsets[0]);
    }

    // first word of the info string is the language (GFM)
    const language = split(mInfo.trim(), String.raw`~\s+~`, { limit: 2 })[0][0];

    return new CodeBlockNode(
      "code",
      mContent.slice(1), // drop the separator "\n"; intentional blank lines stay
      language === "" ? null : language,
      mod,
      { offset: offsets[0], length: matches[0].length },
    );
  }

  /**
   * Parses blocks /--foo.
   */
  parse(context, matches, offsets) {
    const [, mParam, mMod, mContent] = matches;

    const mod = Modifier.parse(mMod, offsets[2] ?? null);
    const parts = split(mParam, String.raw`~\s+~`, { limit: 2 }).map(p => p[0]);
    // the opening pattern matches case-insensitively, so /--PRE must mean
    // the same as /--pre; only the type is lowercased, a language name
    // keeps its spelling
    const blocktype = parts[0] === "" ? Syntax.BlockDefault : "block/" + parts[0].toLowerCase();
    const param = parts[1] === "" ? null : parts[1];

    let [content, map] = OffsetMap.outdentLines(OffsetMap.linesOf(mContent, offsets[3]));
    const range = { offset: offsets[0], length: matches[0].length };

    if (blocktype === Syntax.BlockCode) {
      return new CodeBlockNode("code", content, param, mod, range, null, map);
    } else if (blocktype === Syntax.BlockDefault) {
      return new CodeBlockNode("default", content, param, mod, range, null, map);
    } else if (blocktype === Syntax.BlockPre) {
      return new CodeBlockNode("pre", content, param, mod, range, this.parseHtml(context, content, map), map);
    } else if (blocktype === Syntax.BlockComment) {
      return new CommentNode(content, range);
    } else if (blocktype === Syntax.BlockHtml || blocktype === Syntax.BlockText) {
      // html/text blocks don't use outdent - preserve original indentation
      content = mContent.replace(/^\n+|\n+$/g, "");
      map = OffsetMap.fromLines(OffsetMap.linesOf(content, offsets[3] + mContent.match(/^\n+/)[0].length));
      return blocktype === Syntax.BlockHtml
        ? new CodeBlockNode("html", content, null, mod, range, this.parseHtml(context, content, map), map)
        : new CodeBlockNode("text", content, null, mod, range, null, map);
    } else if (blocktype === Syntax.BlockDiv) {
      const [outdented, divMap] = OffsetMap.outdentLines(
        OffsetMap.linesOf(mContent, offsets[3]),
        true, // firstLine
      );
      if (outdented === "") return null;
      const parsed = context.parseBlock(outdented);
      divMap.applyTo(parsed);
      return new SectionNode(parsed, "div", mod, range);
    } else if (blocktype === Syntax.BlockTexySource) {
      // parsed as Texy at parse time, its HTML is displayed as source code
      if (content === "") return null;
      const parsed = context.parseBlock(content);
      map.applyTo(parsed);
      return new CodeBlockNode("texysource", content, null, mod, range, parsed, map);
    }

    // /--php and friends: a code block in that language. Anything that
    // does not look like a language name stays refused and degrades to
    // visible text.
    return match(parts[0], String.raw`~^[a-z][a-z0-9_+#-]*$~i`)
      ? new CodeBlockNode("code", content, parts[0], mod, range, null, map)
      : null;
  }

  /**
   * Parses the markup of html and pre blocks, which knows HTML tags,
   * comments and entities only.
   * @param {import('../Parsing/ParseContext.js').ParseContext} context
   * @param {string} text
   * @param {OffsetMap} map
   * @returns {ContentNode}
   */
  parseHtml(context, text, map) {
    const parsed = context
      .getInlineParser()
      .withPatterns([Syntax.HtmlTag, Syntax.HtmlComment, Syntax.HtmlEntity])
      .parse(context, text);
    map.applyTo(parsed);
    return parsed;
  }
}
