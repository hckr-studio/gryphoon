/**
 * Quick fixes over the lint issues: close an unclosed HTML tag at the
 * end of its block, delete a stray closing tag, escape a rejected tag
 * to the text it would render as anyway, and insert a definition stub
 * for an undefined reference.
 *
 * All facts (tag and reference names) are read from the AST node the
 * issue points at; the issue message is only a last-resort fallback.
 * Edits are in normalized coordinates; the server bridges them out.
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import { HtmlTagNode, ImageNode, LinkNode } from "@gryphoon/texy/nodes.js";

/**
 * The source extent of a node, derived from all ranges in its subtree.
 * @param {Object} node
 * @returns {?{ offset: number, length: number }}
 */
function extentOf(node) {
  let from = Infinity;
  let to = -Infinity;
  new NodeTraverser().traverse(node, n => {
    if (n.range !== null) {
      from = Math.min(from, n.range.offset);
      to = Math.max(to, n.range.offset + n.range.length);
    }
    return null;
  });
  return from === Infinity ? null : { offset: from, length: to - from };
}

/**
 * The node the issue was reported at (marker: identical range).
 * @param {Object} document the parsed AST
 * @param {{ offset: number, length: number }} range
 * @returns {?Object}
 */
function nodeAt(document, range) {
  let found = null;
  new NodeTraverser().traverse(document, node => {
    if (
      found === null &&
      (node instanceof HtmlTagNode || node instanceof LinkNode || node instanceof ImageNode) &&
      node.range !== null &&
      node.range.offset === range.offset &&
      node.range.length === range.length
    ) {
      found = node;
    }
    return null;
  });
  return found;
}

/** @param {Object} document @param {number} offset */
function blockEndAt(document, offset) {
  let end = null;
  for (const block of document.content.children) {
    const extent = extentOf(block);
    if (extent !== null && extent.offset <= offset && offset < extent.offset + extent.length) {
      end = extent.offset + extent.length;
    }
  }
  return end;
}

/**
 * The definition-stub edit appending `[name]: https://` (a blank line
 * away from the last block) at the end of the document.
 * @param {string} text the normalized source
 * @param {string} name
 * @param {boolean} image
 */
function appendDefinition(text, name, image) {
  const lead = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return {
    range: { offset: text.length, length: 0 },
    text: `${lead}[${image ? `*${name}*` : name}]: https://`,
  };
}

/**
 * The quick fixes for the lint issues overlapping the requested range.
 * @param {{ ast: Object, issues: Array<{ code: string, message: string, range: ?{ offset: number, length: number } }>, normalized: string }} analysis
 * @param {number} from normalized range start
 * @param {number} to normalized range end
 * @returns {Array<{ title: string, issue: Object, edits: Array<{ range: { offset: number, length: number }, text: string }> }>}
 */
export function quickFixes(analysis, from, to) {
  const actions = [];

  for (const issue of analysis.issues) {
    if (issue.range === null) {
      continue;
    }
    const overlap = issue.range.offset < to && from < issue.range.offset + issue.range.length;
    if (!overlap) {
      continue;
    }

    const node = nodeAt(analysis.ast, issue.range);
    const nameFromMessage = issue.message.match(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/)?.[1]
      ?? issue.message.match(/"([^"]+)"/)?.[1]
      ?? null;

    let fix = null;
    switch (issue.code) {
      case "html/tag-unclosed": {
        const name = (node instanceof HtmlTagNode ? node.name : null) ?? nameFromMessage;
        if (name !== null) {
          const at = blockEndAt(analysis.ast, issue.range.offset) ?? issue.range.offset + issue.range.length;
          fix = { title: `Insert </${name}>`, edits: [{ range: { offset: at, length: 0 }, text: `</${name}>` }] };
        }
        break;
      }
      case "html/tag-stray": {
        const name = (node instanceof HtmlTagNode ? node.name : null) ?? nameFromMessage;
        const label = name === null ? "Delete stray closing tag" : `Delete stray </${name}>`;
        fix = { title: label, edits: [{ range: issue.range, text: "" }] };
        break;
      }
      case "html/tag-rejected": {
        const name = (node instanceof HtmlTagNode ? node.name : null) ?? nameFromMessage;
        const escaped = analysis.normalized
          .slice(issue.range.offset, issue.range.offset + issue.range.length)
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
        fix = { title: `Escape <${name}> to text`, edits: [{ range: issue.range, text: escaped }] };
        break;
      }
      case "link/reference-undefined":
      case "image/reference-undefined": {
        const name = (node instanceof LinkNode || node instanceof ImageNode ? node.ref : null) ?? nameFromMessage;
        const image = issue.code === "image/reference-undefined";
        if (name !== null) {
          fix = {
            title: image ? `Define image reference "${name}"` : `Define reference "${name}"`,
            edits: [appendDefinition(analysis.normalized, name, image)],
          };
        }
        break;
      }
    }

    if (fix !== null) {
      actions.push({ title: fix.title, issue, edits: fix.edits });
    }
  }

  return actions;
}
