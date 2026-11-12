/**
 * Replaces emoticons with Unicode characters (port of
 * Texy\Modules\EmoticonModule). Parses EmoticonNodes when the syntax is
 * enabled via allowed['emoticon'].
 */

import { EmoticonNode } from "../nodes.js";
import { quote } from "../Regexp.js";
import { Syntax } from "../Syntax.js";
import { Module } from "./Module.js";

export class EmoticonModule extends Module {
  constructor(texy) {
    super();
    this.texy = texy;

    /** @type {Object<string, string>} emoticon -> emoji/image mapping */
    this.icons = {
      ":-)": "🙂",
      ":-(": "☹",
      ";-)": "😉",
      ":-D": "😁",
      "8-O": "😮",
      "8-)": "😄",
      ":-?": "😕",
      ":-x": "😶",
      ":-P": "😛",
      ":-|": "😐",
    };

    texy.allowed[Syntax.Emoticon] = false;
  }

  beforeParse() {
    // icons sorted longest-first; the last char may repeat
    const icons = Object.keys(this.icons).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // krsort: descending key order
    const pattern = icons.map(key => quote(key, "~") + "+").join("|");

    this.texy.addInlineSyntax(
      Syntax.Emoticon,
      String.raw`~
				(?<= ^ | [\x00-\x20] )
				(` +
        pattern +
        `)
			~x`,
      (context, matches, offsets) => this.parse(context, matches, offsets),
    );
  }

  /**
   * Parses :-); picks the icon that is a prefix of the match.
   * @param {import('../Parsing/ParseContext.js').ParseContext} context
   */
  parse(context, matches, offsets) {
    const match = matches[0];

    for (const emoticon of Object.keys(this.icons)) {
      if (match.startsWith(emoticon)) {
        const node = new EmoticonNode(emoticon, { offset: offsets[0], length: matches[0].length });
        node.resolved = this.icons[emoticon];
        return node;
      }
    }

    return null;
  }
}
