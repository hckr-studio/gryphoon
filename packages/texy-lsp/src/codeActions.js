/**
 * Code actions: quick fixes over the lint issues, and the extract
 * refactorings (an inline link/image target becomes a reference use
 * with the definition appended at the document end). Edits are in
 * normalized coordinates; the server bridges them out.
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
function appendDefinition(analysis, name, image) {
  return appendReference(analysis, name, "https://", image);
}

/**
 * The definition edit appending `[name]: target` (images: `[*name*]`)
 * at the document end: a blank line away from the prose, but tight
 * under the existing definition list when the document already ends
 * in one (`[a]: …` then `[b]: …` on the next line).
 * @param {{ normalized: string, definitionNodes: Array }} analysis
 * @param {string} name
 * @param {string} target the definition URL
 * @param {boolean} image
 */
function appendReference(analysis, name, target, image) {
  const text = analysis.normalized;
  const trimmedLength = text.replace(/\s+$/, "").length;
  const endsWithDefinition = analysis.definitionNodes.some(
    node => node.range !== null && node.range.offset <= trimmedLength && trimmedLength <= node.range.offset + node.range.length,
  );
  const lead = text === ""
    ? ""
    : endsWithDefinition
      ? "\n"
      : text.endsWith("\n")
        ? "\n"
        : "\n\n";
  return {
    range: { offset: text.length, length: 0 },
    text: `${lead}[${image ? `*${name}*` : name}]: ${target}`,
  };
}

/**
 * The reference name for an extracted target: the URL host's first
 * label (www stripped), a slug of the mailto local part, or a slug of
 * the leading path segment for relative targets.
 * @param {string} url
 * @returns {string}
 */
function referenceNameFrom(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") {
      return slug(parsed.pathname.split("@")[0] || "mail");
    }
    const host = parsed.hostname.replace(/^www\./, "");
    return slug(host.split(".")[0] || "link");
  } catch {
    return slug(url.split(/[/?:#]/)[0] || "link");
  }
}

/** @param {string} text a lowercase-safe slug of a reference name */
function slug(text) {
  const s = text.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return s === "" ? "ref" : s;
}

/**
 * The extract refactorings for the range: an inline link/image target
 * becomes a reference use plus a `[name]: url` definition appended at
 * the end of the document (`"Google":https://google.com` turns into
 * `"Google":[google]` + `[google]: https://google.com`, an image's
 * URL inside `[*...*]` becomes the reference name).
 * @param {{ ast: Object, issues: Array, normalized: string, uses: Array<{ name: string }>, definitions: Map<string, Object> }} analysis
 * @param {number} from normalized range start
 * @param {number} to normalized range end
 * @returns {Array<{ title: string, edits: Array<{ range: { offset: number, length: number }, text: string }> }>}
 */
/**
 * Does the written link/image target resolve directly (a URL) rather
 * than name a reference? A reference use (`"x":[ref]`, `[*ref*]`) has
 * nothing to extract; a URL-shaped target has.
 * @param {string} target the written target
 * @returns {boolean}
 */
function looksLikeDirectTarget(target) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) || // scheme (https:, mailto:, ...)
    /^(www\.|\/\/|\/|#|\?)/i.test(target) || // site-relative, anchor, query
    target.includes("@") // e-mail target
  );
}

export function refactors(analysis, from, to) {
  const actions = [];
  const taken = new Set([
    ...analysis.definitions.keys(),
    ...analysis.uses.map(use => use.name.toLowerCase()),
  ]);

  new NodeTraverser().traverse(analysis.ast, node => {
    const extractableLink =
      (node instanceof LinkNode && !node.isImageLink) ||
      node instanceof ImageNode;
    if (!extractableLink || node.urlRange === null) {
      return null;
    }
    // for the bracketed form urlRange covers the brackets too
    const written = analysis.normalized.slice(node.urlRange.offset, node.urlRange.offset + node.urlRange.length);
    const target = written.startsWith("[") && written.endsWith("]") ? written.slice(1, -1) : written;
    if (!looksLikeDirectTarget(target)) {
      // reference use or a name-like target: nothing to extract
      return null;
    }
    const extent = extentOf(node);
    if (extent === null || !(extent.offset < to && from < extent.offset + extent.length)) {
      return null;
    }

    const image = node instanceof ImageNode;
    const base = referenceNameFrom(target);
    let name = base;
    let counter = 2;
    while (taken.has(name)) {
      name = `${base}${counter++}`;
    }
    taken.add(name);

    actions.push({
      title: `Extract ${image ? "image" : "link"} target to reference "${name}"`,
      edits: [
        { range: { offset: node.urlRange.offset, length: node.urlRange.length }, text: image ? name : `[${name}]` },
        appendReference(analysis, name, target, image),
      ],
    });
    return null;
  });

  return actions;
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
            edits: [appendDefinition(analysis, name, image)],
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
