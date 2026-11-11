/**
 * Texy basic configurators (port of Texy\Configurator).
 *
 * <code>
 * import { Texy, Configurator } from 'texy';
 * const texy = new Texy();
 * Configurator.safeMode(texy);
 * </code>
 */

import { None } from "./HtmlPolicy.js";
import { defaultAllowedTags } from "./Output/Html/Schema.js";
import { Syntax } from "./Syntax.js";

/**
 * Tag => list of allowed attributes.
 */
export const SafeTags = {
  a: ["href", "title"],
  abbr: ["title"],
  b: [],
  br: [],
  cite: [],
  code: [],
  em: [],
  i: [],
  strong: [],
  sub: [],
  sup: [],
  q: [],
  small: [],
};

export class Configurator {
  constructor() {
    throw new Error("Cannot instantiate static class " + this.constructor.name);
  }

  /**
   * Configure Texy! for web comments and other usages, where input text
   * may insert attacker. Images and figures are disabled unless $images
   * allows them, the definitions of images stay disabled.
   * @param {import('./Texy.js').Texy} texy
   * @param {boolean} images keep images and figures enabled
   */
  static safeMode(texy, images = false) {
    texy.htmlPolicy.allowedClasses = None; // no class or ID are allowed
    texy.htmlPolicy.allowedStyles = None; // style modifiers are disabled
    // only some "safe" HTML tags and attributes are allowed; the '*' list names
    // attributes acceptable on any element and is the only source for modifiers
    texy.htmlPolicy.allowedTags = { ...SafeTags, "*": ["title", "lang", "dir"] };
    texy.urlPolicy.linkPattern = String.raw`~https?:|ftp:|mailto:~A`;
    texy.urlPolicy.imagePattern = String.raw`~https?:~A`;
    if (images) {
      texy.allowed[Syntax.ImageDefinition] = false;
    } else {
      Configurator.disableImages(texy);
    }
    texy.allowed[Syntax.LinkDefinition] = false; // disable [ref]: URL reference definitions
    texy.allowed[Syntax.HtmlComment] = false; // disable HTML comments
    texy.htmlOutput.linkNoFollow = true; // force rel="nofollow"
  }

  /**
   * Disable all links.
   * @param {import('./Texy.js').Texy} texy
   */
  static disableLinks(texy) {
    texy.allowed[Syntax.AutolinkEmail] = false;
    texy.allowed[Syntax.AutolinkUrl] = false;
    texy.allowed[Syntax.LinkDefinition] = false;
    texy.allowed[Syntax.LinkReference] = false;
    texy.phraseModule.linksAllowed = false;
    Configurator.disallowTags(texy, "a");
  }

  /**
   * Disable all images.
   * @param {import('./Texy.js').Texy} texy
   */
  static disableImages(texy) {
    texy.allowed[Syntax.Image] = false;
    texy.allowed[Syntax.Figure] = false;
    texy.allowed[Syntax.ImageDefinition] = false;
    Configurator.disallowTags(texy, "img", "object", "embed", "applet");
  }

  /**
   * Removes tags from allowedTags, matching both the keys and the bare
   * tag-name values; also works when all tags are allowed.
   * @param {import('./Texy.js').Texy} texy
   * @param {...string} names
   */
  static disallowTags(texy, ...names) {
    const tags = texy.htmlPolicy.allowedTags;
    if (tags === false) {
      return;
    }

    const base = tags === true ? defaultAllowedTags : tags;
    const filtered = {};
    for (const [key, value] of Object.entries(base)) {
      if (!names.includes(key) && !(typeof value === "string" && names.includes(value))) {
        filtered[key] = value;
      }
    }
    texy.htmlPolicy.allowedTags = filtered;
  }
}
