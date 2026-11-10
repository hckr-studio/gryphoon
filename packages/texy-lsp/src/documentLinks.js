/**
 * Document links over the URLs appearing in the text: autolinks, bare
 * email autolinks, the written target of links/images, and the target
 * of reference definitions. Relative targets resolve against the
 * document URI (a file: document); scheme-bearing targets pass
 * through unchanged. Ranges are normalized; the server bridges them.
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import { EmailNode, ImageDefinitionNode, ImageNode, LinkDefinitionNode, LinkNode, UrlNode } from "@gryphoon/texy/nodes.js";

/**
 * Resolves a link target: unchanged when it carries a scheme (https:,
 * mailto:, …), else resolved against the document URI when it is a
 * file document.
 * @param {string} target
 * @param {string} baseUri
 * @returns {string}
 */
function resolveTarget(target, baseUri) {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || !baseUri.startsWith("file:")) {
    return target;
  }
  try {
    return new URL(target, baseUri).toString();
  } catch {
    return target;
  }
}

/**
 * The written-URL token inside a reference-definition line: the first
 * whitespace-delimited run after the `]:` separator (the definition may
 * carry a modifier after the URL).
 * @param {LinkDefinitionNode|ImageDefinitionNode} node
 * @param {string} text the normalized source
 * @returns {?{ offset: number, length: number }}
 */
function definitionUrlRange(node, text) {
  const line = text.slice(node.range.offset, node.range.offset + node.range.length);
  const at = line.indexOf("]:");
  if (at === -1) {
    return null;
  }
  const rest = line.slice(at + 2);
  const leading = rest.length - rest.trimStart().length;
  const token = rest.trimStart().split(/\s+/)[0] ?? "";
  if (token === "") {
    return null;
  }
  return { offset: node.range.offset + at + 2 + leading, length: token.length };
}

/**
 * Collects the document's URL links.
 * @param {import("@gryphoon/texy/nodes.js").DocumentNode} document
 * @param {string} text the normalized source
 * @param {string} uri the document URI (relative targets resolve against it)
 * @param {Map<string, *>} definitions resolved reference definitions; a
 *   [ref] use whose name is undefined links nowhere
 * @returns {Array<{ range: { offset: number, length: number }, target: string }>}
 */
export function collectDocumentLinks(document, text, uri, definitions) {
  const links = [];
  new NodeTraverser().traverse(document, node => {
    let range = null;
    let target = null;

    if (node instanceof UrlNode || node instanceof EmailNode) {
      range = node.range;
      target = node instanceof UrlNode ? node.url : `mailto:${node.email}`;
    } else if (node instanceof LinkNode || node instanceof ImageNode) {
      // a [ref] use links to the resolved target; a direct link lays the
      // link over its written URL when there is one
      const defined = node.ref === null || definitions.has(node.ref.toLowerCase());
      if (node.url !== null && defined) {
        range = node.ref !== null ? node.range : (node.urlRange ?? node.range);
        target = node.url;
      }
    } else if ((node instanceof LinkDefinitionNode || node instanceof ImageDefinitionNode) && node.range !== null && node.url) {
      range = definitionUrlRange(node, text);
      target = node.url;
    }

    if (range !== null && target !== null) {
      links.push({ range, target: resolveTarget(target, uri) });
    }
    return null;
  });
  return links;
}
