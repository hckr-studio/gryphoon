/**
 * Autodetects URLs and email addresses in text
 * (port of Texy\Modules\AutolinkModule).
 */

import { decodeEntities } from "../helpers.js";
import { EmailNode, UrlNode } from "../nodes.js";
import { Email, Letter } from "../Patterns.js";
import { Syntax } from "../Syntax.js";
import { Module } from "./Module.js";

export class AutolinkModule extends Module {
  constructor(texy) {
    super();
    this.texy = texy;
  }

  beforeParse() {
    // direct url; characters not allowed in URL <>[\\]^`{|}
    const char = String.raw`[/\d` + Letter + String.raw`+.\~%&?@=_:;#$!,*-]`;
    // a ) is taken only to close its own (
    const paren =
      String.raw`(?: \( ` + char + String.raw`{0,1000}+ \) | \( ) ` + char + String.raw`{0,1000}`;
    this.texy.addInlineSyntax(
      Syntax.AutolinkUrl,
      String.raw`~
				(?<= ^ | [\s([<:>] )                 # must be preceded by these chars, > ends a tag
				(?: https?:// | www\. | ftp:// )     # protocol or www
				[0-9.` +
        Letter +
        String.raw`-]      # first char
				` +
        char +
        String.raw` (?: ` +
        char +
        String.raw`{1,1000} (?:` + paren + String.raw`){0,10} | (?:` + paren + String.raw`){1,10} )  # URL body
				(?<= [/\d` +
        Letter +
        String.raw`+\~@=_#$*)] )  # last char
			~x`,
      (context, matches, offsets) => this.parseUrl(context, matches, offsets),
    );

    // direct email
    this.texy.addInlineSyntax(
      Syntax.AutolinkEmail,
      String.raw`~
				(?<= ^ | [\s([<>] )                  # must be preceded by these chars
` +
        Email +
        String.raw`
			~x`,
      (context, matches, offsets) => this.parseEmail(context, matches, offsets),
    );
  }

  /**
   * @param {import('../Parsing/ParseContext.js').ParseContext} context
   */
  parseUrl(context, matches, offsets) {
    return new UrlNode(decodeEntities(matches[0]), { offset: offsets[0], length: matches[0].length });
  }

  /**
   * @param {import('../Parsing/ParseContext.js').ParseContext} context
   */
  parseEmail(context, matches, offsets) {
    return new EmailNode(decodeEntities(matches[0]), { offset: offsets[0], length: matches[0].length });
  }
}
