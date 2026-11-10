/**
 * Evaluates the tag whitelist and validation over the paired passthrough
 * tree in the transform phase (port of Texy\Passes\HtmlSanitizePass):
 * rejected tags and elements are replaced by TextNode with the
 * reconstructed tag source, so the AST tells the truth - escaped tags are
 * visible text, allowed tags are markup. Renderers keep their own checks
 * as defense in depth.
 */

import { decodeEntities } from "../helpers.js";
import { Severity } from "../Lint.js";
import { NodeTraverser } from "../NodeTraverser.js";
import { ContentNode, HtmlElementNode, HtmlTagNode, TextNode } from "../nodes.js";

export class HtmlSanitizePass {
  /**
   * @param {import('../HtmlPolicy.js').HtmlPolicy} policy
   * @param {?import('../Lint.js').LintCollector} lint optional issue collector
   */
  constructor(policy, lint = null) {
    this.policy = policy;
    this.lint = lint;
  }

  /** @param {import('../nodes.js').DocumentNode} doc */
  process(doc) {
    new NodeTraverser().traverse(doc, node => {
      if (node instanceof ContentNode && node.children.length > 0) {
        node.children = this.sanitize(node.children);
      }
      return null;
    });
  }

  /**
   * Replaces rejected tags/elements in the list by their text form.
   * Children of a rejected element are sanitized recursively and spliced
   * in place - once spliced they are direct children of an already
   * processed container, so the traverser would not check them again.
   * @param {Array} children
   */
  sanitize(children) {
    const out = [];
    for (const child of children) {
      if (child instanceof HtmlTagNode) {
        if (!this.policy.isTagAcceptable(child.name.toLowerCase(), child.attributes, child.closing)) {
          this.lint?.report(child.range, `Tag <${child.name}> is not allowed and will be rendered as text.`, {
            code: "html/tag-rejected",
          });
          out.push(new TextNode(decodeEntities(this.policy.reconstructTag(child)), child.range));
          continue;
        }

        // the tag stays, but only with the attributes the whitelist names
        this.filterAttributes(child, child.name.toLowerCase());
      } else if (child instanceof HtmlElementNode) {
        if (!this.policy.isTagAcceptable(child.name.toLowerCase(), child.attributes, false)) {
          this.lint?.report(child.range, `Tag <${child.name}> is not allowed and will be rendered as text.`, {
            code: "html/tag-rejected",
          });
          const open = new HtmlTagNode(child.name, { ...child.attributes }, false, false, child.range);
          const close = child.closingTag ?? new HtmlTagNode(child.name, {}, true);
          out.push(new TextNode(decodeEntities(this.policy.reconstructTag(open)), child.range));
          for (const inner of this.sanitize(child.content.children)) {
            out.push(inner);
          }
          out.push(new TextNode(decodeEntities(this.policy.reconstructTag(close)), close.range));
          continue;
        }

        this.filterAttributes(child, child.name.toLowerCase());
      }

      out.push(child);
    }

    return out;
  }

  /**
   * Filters attributes in place, reporting the dropped ones.
   * @param {import('../nodes.js').HtmlTagNode|import('../nodes.js').HtmlElementNode} node
   * @param {string} name lowercased tag name
   */
  filterAttributes(node, name) {
    const filtered = this.policy.filterAttrs(name, node.attributes);
    const dropped = Object.keys(node.attributes).filter(attr => !(attr in filtered));
    if (dropped.length > 0) {
      this.lint?.report(
        node.range,
        `Attribute${dropped.length > 1 ? "s" : ""} ${dropped.join(", ")} not allowed on <${name}> - dropped.`,
        { severity: Severity.Information, code: "html/attr-dropped" },
      );
    }
    node.attributes = filtered;
  }
}
