/**
 * Processes link references and bare [ref] links (port of
 * Texy\Modules\LinkReferenceModule).
 *
 * Definitions carry the Texy 3 label and modifier, restored for
 * historical documents (the 4-dev reference deprecates them): a bare
 * [ref] use shows the inline-parsed label as content (or the textual
 * URL when there is none, circular labels render raw - the Texy 3
 * livelock), and the definition's modifier applies to every use site,
 * the use-site modifier on top. A reference URL may carry %s, replaced
 * with the use-site text (form-url-encoded).
 */

import { decodeEntities, formUrlencode, toLower } from "../helpers.js";
import { Modifier, mergeModifiers } from "../Modifier.js";
import { extractText, find } from "../NodeHelpers.js";
import { NodeTraverser } from "../NodeTraverser.js";
import { ContentNode, LinkDefinitionNode, LinkNode, TextNode, UrlNode } from "../nodes.js";
import { Email, Modifier as ModifierPattern } from "../Patterns.js";
import { match } from "../Regexp.js";
import { Stage } from "../Stage.js";
import { Syntax } from "../Syntax.js";
import { Module } from "./Module.js";

/**
 * Is the bracketed link target a direct URL rather than a reference use?
 * Texy is forgiving: an undefined reference falls back to a relative URL,
 * so only URL-shaped targets can be told apart from reference typos -
 * those are direct links by intent (linting skips them).
 * @param {string} target
 */
function looksLikeUrl(target) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) || // scheme (https:, mailto:, ...)
    /^(www\.|\/\/|\/|\.\.?($|\/)|#|\?)/i.test(target) || // site-relative, anchor, query
    Boolean(match(target, "~" + Email + "(\\?\\S*)?$~A")) // e-mail target
  );
}

/**
 * The [*img*] link-target form: a file-path-like name is a direct image
 * URL, not a reference use (linting skips those).
 * @param {string} target
 */
function looksLikeImageUrl(target) {
  return looksLikeUrl(target) || target.includes("/") || target.includes(".");
}

export class LinkReferenceModule extends Module {
  constructor(texy) {
    super();
    this.texy = texy;
    texy.allowed[Syntax.LinkDefinition] = true;
    texy.allowed[Syntax.LinkReference] = false;
    texy.addPass(doc => this.recognizeReferences(doc), Stage.Syntax);
    texy.addPass(doc => this.resolveReferences(doc));

    /**
     * Texy 3 reference semantics, opt-in for historical documents
     * (the 4-dev reference deprecates and ignores them): the
     * definition's label becomes the content of a bare [ref] use
     * (inline parsed, circular labels render raw), the definition's
     * modifier applies to every use site under the use-site
     * modifier, a %s in a reference URL takes the use-site text
     * (form-url-encoded), and an image definition's modifier
     * applies to [*img*] link targets.
     * @type {boolean}
     */
    this.legacyReferences = false;

    /** @type {Object<string, LinkDefinitionNode>} link definitions */
    this.definitions = {};
    /** @type {Object<string, LinkDefinitionNode>} user-defined definitions (persist across parse() calls) */
    this.userDefinitions = {};
  }

  beforeParse() {
    // the Texy 3 semantics imply the bare [ref] syntax - it was always
    // allowed in Texy 3; an explicit allowed['link/reference'] = false
    // still disables it
    if (this.legacyReferences && this.texy.allowed[Syntax.LinkReference] === false) {
      this.texy.allowed[Syntax.LinkReference] = true;
    }

    // [ref]: url label .(title)[class]{style}
    this.texy.addBlockSyntax(
      Syntax.LinkDefinition,
      String.raw`~^
				\[
				( [^\[\]#?*\n]{1,100} )           # reference (1)
				] : [ \t]++
				( \S{1,1000} )                    # URL (2)
				( [ \t] .{1,1000} )?              # optional label (3)
				` +
        ModifierPattern +
        String.raw`?       # modifier (4)
				\s*
			$~mUx`,
      (context, matches, offsets) => this.parseDefinition(context, matches, offsets),
    );

    // [reference] - bare reference link (opt-in); the raw target is kept in
    // LinkNode.ref for consumer resolution passes (wiki links etc.)
    this.texy.addLineSyntax(
      Syntax.LinkReference,
      String.raw`~
				(?<! [.\#\[])        # exclude modifier .[class], PHP attribute #[Attr] and nested [
				\[
				( [^\[\]*|\n]++ )     # reference name (1); * would be an image, | a labeled form
				]
			~Ux`,
      (context, matches, offsets) => this.parseReference(context, matches, offsets),
    );
  }

  /**
   * Parses bare [ref].
   */
  parseReference(context, matches, offsets) {
    const [, mRef] = matches;
    const refRange = { offset: offsets[1], length: mRef.length };
    return new LinkNode(
      null,
      new ContentNode([new TextNode(decodeEntities(mRef), refRange)]),
      null,
      { offset: offsets[0], length: matches[0].length },
      false,
      mRef,
      Syntax.LinkReference,
      refRange,
      refRange,
    );
  }

  /**
   * Parses [ref]: url label .(title)[class]{style}.
   */
  parseDefinition(context, matches, offsets) {
    const [, mRef, mURL, mLabel, mMod] = matches;
    // the label group swallows the modifier when both are present -
    // the Texy 3 definition regex shape, kept as is
    const label = mLabel !== null && mLabel !== undefined && mLabel.trim() !== "" ? mLabel.trim() : null;
    const modifier = mMod !== null && mMod !== undefined ? Modifier.parse(mMod, offsets[4] ?? null) : null;
    return new LinkDefinitionNode(mRef, mURL, { offset: offsets[0], length: matches[0].length }, label, modifier);
  }

  /**
   * Adds a user-defined link definition (persists across parse() calls).
   * The label and modifier are the Texy 3 Link::$label / Link::$modifier
   * carriers: the label shows as the content of a bare [ref] use, the
   * modifier applies to every use site. The modifier may be a modifier
   * string or a Modifier instance.
   */
  addDefinition(name, url, label = null, modifier = null) {
    // a modifier string as written (with the leading dot) or a
    // Modifier instance
    const mod = typeof modifier === "string" ? Modifier.parse(modifier.replace(/^\./, "")) : modifier;
    this.userDefinitions[toLower(name)] = new LinkDefinitionNode(name, url, null, label, mod);
  }

  /**
   * Recognizes link targets written as a reference, [ref] or [*img*]: the
   * name goes to LinkNode.ref and the URL is left to resolveReferences()
   * (a Syntax pass, runs inside parse()).
   * @param {import('../nodes.js').DocumentNode} doc
   */
  recognizeReferences(doc) {
    for (const node of find(doc, n => n instanceof LinkNode)) {
      const url = node.url ?? "";
      const len = url.length;
      if (
        len > 4 &&
        url[0] === "[" &&
        url[1] === "*" &&
        url[len - 1] === "]" &&
        ["*", "<", ">"].includes(url[len - 2])
      ) {
        node.ref = url.slice(2, -2).trim();
        node.isImageLink = true;
        node.url = null;
      } else if (len > 2 && url[0] === "[" && url[len - 1] === "]") {
        node.ref = url.slice(1, -1);
        node.url = null;
      }
    }
  }

  /**
   * Resolve link references in the document (transform phase; runs after
   * image references, so [*img*] targets can use image definitions).
   * @param {import('../nodes.js').DocumentNode} doc
   */
  resolveReferences(doc) {
    // Start with user-defined definitions
    this.definitions = { ...this.userDefinitions };

    // Pass 1: Collect document definitions (overwrites user-defined)
    for (const node of find(doc, n => n instanceof LinkDefinitionNode)) {
      this.definitions[toLower(node.reference)] = node;
    }

    // Pass 2: Resolve references in LinkNode.url; an undefined bare [ref]
    // in legacy mode is replaced by literal text (the Texy 3 rendering
    // without a newReference handler)
    this.livelock = new Set(); // circular label references (the Texy 3 livelock)
    this.resolveLinkTree(doc);
  }

  /**
   * Resolves the LinkNodes of a subtree, replacing undefined bare [ref]
   * uses with literal text nodes (the Texy 3 behavior without a
   * newReference handler).
   * @param {Node} root a DocumentNode or a parsed ContentNode subtree
   * @returns {?Node} the root, when the traversal replaced it
   */
  resolveLinkTree(root) {
    return new NodeTraverser().traverse(root, node =>
      node instanceof LinkNode ? this.resolveLinkNodeUrl(node) : null,
    );
  }

  /**
   * Applies the Texy 3 reference semantics to a resolved link node: the
   * definition's modifier merges under the use-site modifier, a %s in the
   * URL takes the use-site text, and a bare [ref] gets the definition's
   * label (inline parsed, recursively resolved) or the textual URL as
   * content.
   * @param {LinkNode} node
   * @param {LinkDefinitionNode} def
   * @param {boolean} bare the bare [ref] form
   */
  applyDefinition(node, def, bare) {
    if (!this.legacyReferences) {
      return;
    }

    // %s substitution - only for use sites with explicit content
    // (the Texy 3 factoryLink), bare [ref] keeps the %s literal
    if (!bare && node.url.includes("%s")) {
      node.url = node.url.replaceAll("%s", formUrlencode(extractText(node.content)));
    }

    node.modifier = mergeModifiers(def.modifier, node.modifier);

    if (bare) {
      if (def.label !== null) {
        const key = toLower(def.reference);
        if (this.livelock.has(key)) {
          // circular reference - the raw label text (Texy 3 livelock)
          node.content = new ContentNode([new TextNode(def.label)]);
        } else {
          this.livelock.add(key);
          const content = this.texy.createParseContext().parseInline(def.label);
          try {
            // references inside the label resolve too (recursively,
            // with this name locked - the Texy 3 livelock stays on
            // for the whole label resolution, not just the parse)
            node.content = this.resolveLinkTree(content) ?? content;
          } finally {
            this.livelock.delete(key);
          }
        }
      } else {
        // no label: the textual URL display (the Texy 3 textualUrl)
        node.content = new ContentNode([new UrlNode(node.url)]);
      }
    }
  }

  /**
   * Resolve URL in LinkNode written as [ref] or [*img*]; a reference not
   * found is used as the URL.
   * @param {LinkNode} node
   * @returns {?TextNode} a literal-text replacement for an undefined bare
   * [ref] in legacy mode, null otherwise
   */
  resolveLinkNodeUrl(node) {
    // the bare [ref] form carries the written name since parsing
    const bare = node.syntax === Syntax.LinkReference;

    if (node.url === null && node.ref != null) {
      if (node.isImageLink) {
        const imgDef = this.texy.imageModule.getDefinition(node.ref);
        if (imgDef != null && imgDef.url !== null) {
          node.url = imgDef.url;
          if (this.legacyReferences) {
            // the image definition's modifier applies to the <a> too
            // (the Texy 3 factoryLink); %s takes the use-site text
            if (imgDef.modifier != null) {
              node.modifier = mergeModifiers(imgDef.modifier, node.modifier);
            }
            if (node.url.includes("%s")) {
              node.url = node.url.replaceAll("%s", formUrlencode(extractText(node.content)));
            }
          }
        } else {
          // Image reference not found - use the name as URL; a
          // file-path-like name is a direct image URL by intent
          if (!looksLikeImageUrl(node.ref)) {
            this.texy.lintCollector?.report(node.range, `Image reference "${node.ref}" is not defined - used as URL.`, {
              code: "image/reference-undefined",
            });
          }
          node.url = node.ref;
        }
        return null;
      }

      const def = this.resolveDefinition(node.ref);
      if (def !== null) {
        node.url = def.url;
        if (this.legacyReferences) {
          this.applyDefinition(node, def, bare);
        }
      } else if (this.legacyReferences && bare) {
        // Texy 3 backward compatibility: an undefined bare [ref] is
        // not a link - with no newReference handler registered, the
        // match renders as the literal [ref] text (the labeled
        // "text":[ref] form still falls back to the name as URL).
        // Normal rendering, not an anomaly - nothing to lint.
        return new TextNode(`[${node.ref}]`, node.range);
      } else {
        // Reference not found - use the reference text as URL; a
        // URL-shaped target is a direct link by intent
        if (!looksLikeUrl(node.ref)) {
          this.texy.lintCollector?.report(node.range, `Reference "${node.ref}" is not defined - used as URL.`, {
            code: "link/reference-undefined",
          });
        }
        node.url = node.ref;
        this.convertEmailUrl(node);
        return null;
      }
    }

    // A %s in the URL stands for the link text (not for the bare [ref] form)
    if (node.url !== null && !bare && node.url.includes("%s")) {
      node.url = node.url.replaceAll("%s", formUrlencode(extractText(node.content)));
    }

    this.convertEmailUrl(node);
  }

  /**
   * Convert e-mail URLs to mailto: scheme. Requires a full e-mail address
   * (Patterns::Email) so that wiki-style targets containing @ are left alone.
   * @param {LinkNode} node
   */
  convertEmailUrl(node) {
    if (
      node.url !== null &&
      !node.url.includes("/") &&
      !/^[a-z][a-z0-9+.-]*:/i.test(node.url) &&
      match(node.url, "~" + Email + "(\\?\\S*)?$~A")
    ) {
      // optional ?subject=... query
      node.url = "mailto:" + node.url;
    }
  }

  /**
   * Find definition by identifier, supports #fragment and ?query.
   * @param {string} identifier
   */
  resolveDefinition(identifier) {
    const key = toLower(identifier);

    if (Object.hasOwn(this.definitions, key)) {
      return this.definitions[key];
    }

    // Support #fragment and ?query
    const hashPos = key.indexOf("#");
    const queryPos = key.indexOf("?");

    // Find the earliest delimiter
    let pos = null;
    if (hashPos !== -1 && queryPos !== -1) {
      pos = Math.min(hashPos, queryPos);
    } else if (hashPos !== -1) {
      pos = hashPos;
    } else if (queryPos !== -1) {
      pos = queryPos;
    }

    if (pos !== null) {
      const baseKey = key.slice(0, pos);
      if (Object.hasOwn(this.definitions, baseKey)) {
        const def = this.definitions[baseKey];
        return new LinkDefinitionNode(def.reference, def.url + identifier.slice(pos), null, def.label, def.modifier);
      }
    }

    return null;
  }
}
