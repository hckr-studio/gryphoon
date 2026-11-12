/**
 * Processes inline text formatting: bold, italic, code, links etc.
 * (port of Texy\Modules\PhraseModule).
 */

import { decodeEntities, unescapeHtml } from "../helpers.js";
import { Modifier } from "../Modifier.js";
import { ContentNode, InlineCodeNode, LinkNode, PhraseNode, RawTextNode, TextNode } from "../nodes.js";
import { Letter, LinkUrl, Modifier as ModifierPattern } from "../Patterns.js";
import { Range } from "../Range.js";
import { Syntax } from "../Syntax.js";
import { Module } from "./Module.js";

const bt = String.fromCharCode(96); // backtick; cannot appear literally in these sources

/**
 * Paired phrases: a delimiter, some content, an optional modifier, the same
 * delimiter again. They all share one skeleton (buildPhrasePattern), so a
 * row only says what the delimiters are and which characters must not touch
 * them; see the reference for the documented deviations.
 */
const Phrases = {
  [Syntax.StrongEmphasis]: {
    open: String.raw`\*\*\*`,
    char: String.raw`\*`,
    guard: String.raw`\\\\`,
    link: true,
    multiline: true,
  },
  [Syntax.Strong]: {
    open: String.raw`\*\*`,
    char: String.raw`\*`,
    guard: String.raw`\\\\`,
    link: true,
    multiline: true,
  },
  // : guards the // in http://
  [Syntax.Emphasis]: { open: String.raw`//`, char: String.raw`/`, guard: String.raw`:`, link: true, multiline: true },
  [Syntax.EmphasisSingleAsterisk]: {
    open: String.raw`\*`,
    char: String.raw`\*`,
    guard: String.raw`\\\\`,
    link: true,
    multiline: true,
    content: String.raw`\s\*`,
    contentPair: String.raw`\*`, // a single * phrase holds no whitespace at all
  },
  [Syntax.EmphasisSingleAsterisk2]: {
    open: String.raw`\*`,
    char: String.raw`\*`,
    guard: String.raw`\\\\`,
    link: true,
    multiline: true,
    beforeOpen: String.raw`[^\s.,;:<>()"'\-]`, // must stand at a word boundary, ...
    afterClose: String.raw`[^\s.,;:<>()"'?!\-]`, // ... hence the inverted classes
  },
  [Syntax.Inserted]: { open: String.raw`\+\+`, char: String.raw`\+` },
  // < and > guard the arrows <-- and -->
  [Syntax.Deleted]: { open: String.raw`--`, char: String.raw`\-`, guard: String.raw`<`, guardAfter: String.raw`>` },
  [Syntax.Superscript]: { open: String.raw`\^\^`, char: String.raw`\^` },
  [Syntax.Subscript]: { open: String.raw`__`, char: String.raw`_` },
  [Syntax.SpanQuotes]: {
    open: String.raw`"`,
    char: String.raw`"`,
    link: true,
    afterOpen: String.raw`\s`,
    beforeClose: String.raw`\s`, // the delimiter may touch itself: ""quoted""
    content: String.raw`\r "`,
    contentPair: " ", // and the content may span lines
  },
  [Syntax.SpanTilde]: {
    open: String.raw`\~`,
    char: String.raw`\~`,
    link: true,
    afterOpen: String.raw`\s`,
    beforeClose: String.raw`\s`,
    content: String.raw`\r \~`,
    contentPair: " ",
  },
  [Syntax.Quote]: {
    open: String.raw`>>`,
    close: String.raw`<<`,
    char: String.raw`>`,
    closeChar: String.raw`<`,
    link: true,
  },
};

/** Wraps characters in a class, unless a single (possibly escaped) one speaks for itself. */
function charClass(chars) {
  return /^(\\.|[^\\])$/.test(chars) ? chars : "[" + chars + "]";
}

/**
 * Builds the pattern of a paired phrase from its delimiter spec:
 * (?<! guard) open (?! space or char) content modifier? (?<! space or guard) close (?! char) (:link)??
 */
function buildPhrasePattern(spec) {
  const char = spec.char;
  const closeChar = spec.closeChar ?? char;
  const guard = spec.guard ?? "";
  const guardAfter = spec.guardAfter ?? "";

  const beforeOpen = spec.beforeOpen ?? charClass(char + guard);
  const afterOpen = spec.afterOpen ?? charClass(String.raw`\s` + char + guardAfter);
  const beforeClose = spec.beforeClose ?? charClass(String.raw`\s` + closeChar + guard);
  const afterClose = spec.afterClose ?? charClass(closeChar + guardAfter);
  const content = spec.content ?? (spec.multiline ? "" : String.raw`\r\n`) + " " + closeChar;
  const contentPair = spec.contentPair ?? " " + closeChar;

  return (
    String.raw`
		(?<! ${beforeOpen} ) ${spec.open} (?! ${afterOpen} )  # opening delimiter
		( (?: [^${content}]++ | [${contentPair}] )+ )  # content (1)
		${ModifierPattern}?  # modifier (2)
		(?<! ${beforeClose} ) ${spec.close ?? spec.open} (?! ${afterClose} )  # closing delimiter` +
    (spec.link
      ? String.raw`
		(?: :(${LinkUrl}) )??  # optional link (3)`
      : "") +
    `
	~U` +
    (spec.multiline ? "s" : "") +
    "x"
  );
}

export class PhraseModule extends Module {
  constructor(texy) {
    super();
    this.texy = texy;
    texy.allowed[Syntax.Inserted] = false;
    texy.allowed[Syntax.Deleted] = false;
    texy.allowed[Syntax.Superscript] = false;
    texy.allowed[Syntax.Subscript] = false;
    this.linksAllowed = true;
  }

  beforeParse() {
    const texy = this.texy;

    for (const [syntax, spec] of Object.entries(Phrases)) {
      texy.addInlineSyntax(syntax, "~" + buildPhrasePattern(spec), this.parsePhrase.bind(this, syntax));
    }

    // m^2 alternative superscript
    texy.addInlineSyntax(
      Syntax.SuperscriptShort,
      String.raw`~
				(?<= [a-z0-9] )                  # preceded by letter or number
				\^
				( [n0-9+-]{1,4}? )               # 1-4 digits, n, + or - (1)
				(?! [a-z0-9] )                   # not followed by letter or number
			~Uix`,
      (context, matches, offsets) => this.parseSupSub(context, matches, offsets, Syntax.SuperscriptShort),
    );

    // m_2 alternative subscript
    texy.addInlineSyntax(
      Syntax.SubscriptShort,
      String.raw`~
				(?<= [a-z] )                     # preceded by letter
				_
				( [n0-9]{1,3} )                  # 1-3 digits or n (1)
				(?! [a-z0-9] )                   # not followed by letter or number
			~Uix`,
      (context, matches, offsets) => this.parseSupSub(context, matches, offsets, Syntax.SubscriptShort),
    );

    // acronym/abbr "et al."((and others))
    texy.addInlineSyntax(
      Syntax.AbbreviationQuotes,
      String.raw`~
				(?<! " )                         # not preceded by "
				"
				(?! \s )                         # not followed by space
				( (?: [^\r\n "]++ | [ ] )+ )     # content (1)
				` +
        ModifierPattern +
        String.raw`?      # modifier (2)
				(?<! \s )                        # not preceded by space
				"
				(?! " )                          # not followed by "
				\(\(
				( .+ )                           # explanation (3)
				\)\)
			~Ux`,
      (context, matches, offsets) => this.parseAcronym(context, matches, offsets, Syntax.AbbreviationQuotes),
    );

    // acronym/abbr NATO((North Atlantic Treaty Organisation))
    texy.addInlineSyntax(
      Syntax.Abbreviation,
      String.raw`~
				(?<! [${Letter}] )  # not preceded by char
				( [${Letter}]{2,} ) # at least 2 chars (1)
				()                               # modifier placeholder (2)
				\(\(
				( (?: [^\n )]++ | [ )] )+ )      # explanation (3)
				\)\)
			~Ux`,
      (context, matches, offsets) => this.parseAcronym(context, matches, offsets, Syntax.Abbreviation),
    );

    // ''notexy''
    texy.addInlineSyntax(
      Syntax.Raw,
      String.raw`~
				(?<! ' )                         # not preceded by quote
				''
				(?! [\s'] )                      # not followed by space or quote
				( (?: [^\r\n']++ | ' )+ )       # content (1)
				(?<! [\s'] )                     # not preceded by space or quote
				''
				(?! ' )                          # not followed by quote
			~Ux`,
      (context, matches, offsets) => this.parseNoTexy(context, matches, offsets),
    );

    // `code`
    texy.addInlineSyntax(
      Syntax.Code,
      "~" +
        bt +
        "\n" +
        " ( \\S (?: [^\\r\\n " +
        bt +
        "]++ | [ " +
        bt +
        "] )* )         # content (1)\n" +
        ModifierPattern +
        "?             # modifier (2)\n" +
        "(?<! \\s )                               # not preceded by space\n" +
        bt +
        "\n" +
        "(?: :(" +
        LinkUrl +
        ") )??  # optional link (3)\n" +
        "~Ux",
      (context, matches, offsets) => this.parsePhrase(Syntax.Code, context, matches, offsets),
    );

    // ....:LINK
    texy.addInlineSyntax(
      Syntax.QuickLink,
      String.raw`~
				( [${Letter}0-9@#$%&.,_-]++ )  # allowed chars (1)
				()                                    # modifier placeholder (2)
				: (?= \[ )                            # followed by :[
				(` +
        LinkUrl +
        String.raw`)          # link (3)
			~Ux`,
      (context, matches, offsets, name) => this.parseLink(context, matches, offsets, name),
    );

    // [text |link]
    texy.addInlineSyntax(
      Syntax.WikiLink,
      String.raw`~
				(?<! \[ )                        # not preceded by [
				\[
				(?! [\s*] )                      # not followed by space or *
				( [^|\r\n\]]++ )                 # text (1)
				\|
				( (?: [^|\r\n \]]++ | [ ] )+ )   # link (2)
				` +
        ModifierPattern +
        String.raw`?      # modifier (3)
				(?<! \s )                        # not preceded by space
				]
				(?! ] )                          # not followed by ]
			~Ux`,
      (context, matches, offsets, name) => this.parseWikilink(context, matches, offsets, name),
    );

    // [text](link)
    texy.addInlineSyntax(
      Syntax.MarkdownLink,
      String.raw`~
				(?<! [[.] )                     # not preceded by [ or .
				\[
				(?! [\s*] )                     # not followed by space or *
				( (?: [^|\r\n \]]++ | [ ] )+ )  # text (1)
				` +
        ModifierPattern +
        String.raw`?     # modifier (2)
				(?<! \s )                       # not preceded by space
				]
				\(
				( (?: [^\r )]++ | [ ] )+ )      # link (3)
				\)
			~Ux`,
      (context, matches, offsets, name) => this.parseLink(context, matches, offsets, name),
    );

    // \* escaped asterisk
    texy.addInlineSyntax(
      Syntax.EscapedAsterisk,
      String.raw`~\\\*~`,
      (context, matches, offsets) => new TextNode("*", { offset: offsets[0], length: 2 }),
    );
  }

  /**
   * Parses phrase patterns. Phrases without a link part (ins, del, sup,
   * sub) have only two groups, hence the optional third one.
   */
  parsePhrase(phrase, context, matches, offsets) {
    // the reference pads the missing link group: $matches + [3 => null]
    const [, mContent, mMod, mLink = null] = matches;
    const range = { offset: offsets[0], length: matches[0].length };
    const contentOffset = offsets[1];
    const textRange = trimRange(mContent, contentOffset);
    const urlRange = mLink === null ? null : { offset: offsets[3], length: mLink.length };

    // For phrase/span and phrase/span-alt, URL makes it a link
    if (phrase === Syntax.SpanQuotes || phrase === Syntax.SpanTilde) {
      if (mLink !== null && this.linksAllowed) {
        return new LinkNode(
          decodeEntities(mLink),
          context.parseInline(mContent.trim(), contentOffset),
          Modifier.parse(mMod, offsets[2] ?? null),
          range,
          false,
          null,
          phrase,
          textRange,
          urlRange,
        );
      } else if (mLink === null && mMod === null) {
        return null;
      }
    }

    const mod = Modifier.parse(mMod, offsets[2] ?? null);
    const node =
      phrase === Syntax.Code
        ? new InlineCodeNode(mContent.trim(), mod, range, textRange) // code content is not parsed recursively
        : new PhraseNode(context.parseInline(mContent.trim(), contentOffset), phrase, mod, range);

    // Other phrases with link
    if (mLink !== null && this.linksAllowed) {
      return new LinkNode(
        decodeEntities(mLink),
        new ContentNode([node]),
        null,
        range,
        false,
        null,
        phrase,
        textRange,
        urlRange,
      );
    }

    return node;
  }

  /** Parses superscript/subscript alternative (m^2, H_2O). */
  parseSupSub(context, matches, offsets, phrase) {
    let mContent = matches[1].replaceAll("-", "\u2212"); // &minus;
    const content = [new TextNode(decodeEntities(mContent), { offset: offsets[1], length: matches[1].length })];
    return new PhraseNode(new ContentNode(content), phrase, null, { offset: offsets[0], length: matches[0].length });
  }

  /** Parses acronym/abbr; the content is inline-parsed. */
  parseAcronym(context, matches, offsets, phrase) {
    const [, mContent, mMod, mTitle] = matches;
    const contentOffset = offsets[1];

    const mod = Modifier.parse(mMod, offsets[2] ?? null) ?? new Modifier();
    mod.title = unescapeHtml(mTitle).trim();
    const content = context.parseInline(mContent.trim(), contentOffset);

    return new PhraseNode(content, phrase, mod, { offset: offsets[0], length: matches[0].length });
  }

  /** Parses ''notexy'' into a literal-source node. */
  parseNoTexy(context, matches, offsets) {
    return new RawTextNode(matches[1], { offset: offsets[0], length: matches[0].length });
  }

  /** Parses links (phrase/quicklink, phrase/markdown); modifiers are intentionally ignored. */
  parseLink(context, matches, offsets, name) {
    const [, mContent, , mLink] = matches;
    const content = context.parseInline(mContent.trim(), offsets[1]);
    if (!this.linksAllowed) {
      return content;
    }

    return new LinkNode(
      decodeEntities(mLink.trim()),
      content,
      null, // quicklink and markdown links don't support modifiers
      { offset: offsets[0], length: matches[0].length },
      false,
      null,
      name,
      trimRange(mContent, offsets[1]),
      trimRange(mLink, offsets[3]),
    );
  }

  /** Parses wikilink [text|link]; modifiers are intentionally ignored. */
  parseWikilink(context, matches, offsets, name) {
    const [, mContent, mLink] = matches;
    const content = context.parseInline(mContent.trim(), offsets[1]);
    if (!this.linksAllowed) {
      return content;
    }

    return new LinkNode(
      decodeEntities(mLink.trim()),
      content,
      null, // wikilinks don't support modifiers
      { offset: offsets[0], length: matches[0].length },
      false,
      null,
      name,
      trimRange(mContent, offsets[1]),
      trimRange(mLink, offsets[2]),
    );
  }
}

/** Range of the text without its surrounding whitespace. */
const trimChars = " \t\n\r\u0000\u000B"; // PHP trim()'s set
function trimRange(text, offset) {
  return {
    offset: offset + text.length - text.replace(new RegExp("^[" + trimChars + "]+"), "").length,
    length: text.replace(new RegExp("^[" + trimChars + "]+|[" + trimChars + "]+$"), "").length,
  };
}
