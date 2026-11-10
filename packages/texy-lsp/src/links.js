/**
 * Link/image reference analysis: use tokens, definitions, the name under
 * the cursor, rename edits, and the reference-health diagnostics
 * (unused/duplicate definitions).
 *
 * The parser keeps the written reference name on resolved nodes
 * (LinkNode.ref, ImageNode.ref) precisely for analyzers like this one;
 * definitions are LinkDefinitionNode / ImageDefinitionNode. All ranges
 * index the normalized source (see @gryphoon/texy's Range).
 */

import { NodeTraverser } from "@gryphoon/texy/NodeTraverser.js";
import {
  ImageDefinitionNode,
  ImageNode,
  LinkDefinitionNode,
  LinkNode,
} from "@gryphoon/texy/nodes.js";

/**
 * Collects reference uses and definitions from a parsed document.
 * @param {import("@gryphoon/texy/nodes.js").DocumentNode} document
 * @returns {{
 *   uses: Array<{ name: string, node: import("@gryphoon/texy/nodes.js").Node }>,
 *   definitions: Map<string, import("@gryphoon/texy/nodes.js").Node>,
 *   definitionNodes: Array<import("@gryphoon/texy/nodes.js").Node>,
 * }}
 */
export function collectReferences(document) {
  const uses = [];
  const definitions = new Map();
  const definitionNodes = [];

  new NodeTraverser().traverse(document, node => {
    if ((node instanceof LinkNode || node instanceof ImageNode) && node.ref) {
      uses.push({ name: node.ref, node });
    } else if (node instanceof LinkDefinitionNode || node instanceof ImageDefinitionNode) {
      definitions.set(node.reference.toLowerCase(), node);
      definitionNodes.push(node);
    }
    return null;
  });

  return { uses, definitions, definitionNodes };
}

/**
 * The exact source range of the `[ref]` / `[*ref*]` token inside a use
 * node, searched from the end because the target follows the content
 * ("label":[ref]). Falls back to the whole node when the written form is
 * not recoverable (e.g. spacing inside the brackets).
 * @param {{ name: string, node: { range: ?{ offset: number, length: number } } }} use
 * @param {string} normalizedText
 * @returns {?{ offset: number, length: number }}
 */
export function refTokenRange(use, normalizedText) {
  const { range } = use.node;
  if (range === null) {
    return null;
  }

  const slice = normalizedText.slice(range.offset, range.offset + range.length);
  for (const token of [`[*${use.name}*]`, `[${use.name}]`]) {
    const at = slice.lastIndexOf(token);
    if (at !== -1) {
      return { offset: range.offset + at, length: token.length };
    }
  }

  return range;
}

/**
 * The exact source range of the `[ref]` / `[*ref*]` name token inside a
 * definition line (`[*ref*]: …`, `[ref]: …`), with the same recover-the-
 * written-form fallback.
 * @param {import("@gryphoon/texy/nodes.js").LinkDefinitionNode|LinkDefinitionNode} definition
 * @param {string} normalizedText
 * @returns {?{ offset: number, length: number }}
 */
export function definitionTokenRange(definition, normalizedText) {
  const { range } = definition;
  if (range === null) {
    return null;
  }

  const tokens = definition instanceof ImageDefinitionNode
    ? [`[*${definition.reference}*]`, `[${definition.reference}]`]
    : [`[${definition.reference}]`, `[*${definition.reference}*]`];
  const slice = normalizedText.slice(range.offset, range.offset + range.length);
  for (const token of tokens) {
    const at = slice.indexOf(token);
    if (at !== -1) {
      return { offset: range.offset + at, length: token.length };
    }
  }

  return range;
}

/**
 * The reference use whose [ref] token contains the offset, if any.
 * @param {{ normalized: string, uses: Array }} analysis
 * @param {number} offset normalized offset
 * @returns {?{ name: string, node: import("@gryphoon/texy/nodes.js").Node }}
 */
export function useAt(analysis, offset) {
  return (
    analysis.uses.find(u => {
      const token = refTokenRange(u, analysis.normalized);
      return token !== null && token.offset <= offset && offset < token.offset + token.length;
    }) ?? null
  );
}

/**
 * The definition node whose source line contains the offset, if any.
 * @param {{ definitionNodes: Array }} analysis
 * @param {number} offset normalized offset
 * @returns {?import("@gryphoon/texy/nodes.js").LinkDefinitionNode|import("@gryphoon/texy/nodes.js").ImageDefinitionNode}
 */
export function definitionAt(analysis, offset) {
  return (
    analysis.definitionNodes.find(d => d.range !== null && d.range.offset <= offset && offset < d.range.offset + d.range.length) ?? null
  );
}

/**
 * The reference name under the cursor: the use token's name, else the
 * definition line's name.
 * @param {{ normalized: string, uses: Array, definitionNodes: Array }} analysis
 * @param {number} offset normalized offset
 * @returns {?string}
 */
export function refNameAt(analysis, offset) {
  const use = useAt(analysis, offset);
  if (use !== null) {
    return use.name;
  }
  return definitionAt(analysis, offset)?.reference ?? null;
}

/**
 * Reference rename: one edit per use token and per definition token,
 * preserving each site's written form ([ref] vs [*ref*]). Edits are in
 * normalized coordinates.
 * @param {{ normalized: string, uses: Array, definitionNodes: Array }} analysis
 * @param {string} name the reference name being renamed
 * @param {string} newName
 * @returns {Array<{ range: { offset: number, length: number }, text: string }>}
 */
export function renameEdits(analysis, name, newName) {
  const key = name.toLowerCase();
  const edits = [];

  for (const use of analysis.uses) {
    if (use.name.toLowerCase() !== key) {
      continue;
    }
    const token = refTokenRange(use, analysis.normalized);
    if (token === null) {
      continue;
    }
    const image = analysis.normalized.slice(token.offset, token.offset + token.length).startsWith("[*");
    edits.push({ range: token, text: image ? `[*${newName}*]` : `[${newName}]` });
  }

  for (const definition of analysis.definitionNodes) {
    if (definition.reference.toLowerCase() !== key) {
      continue;
    }
    const token = definitionTokenRange(definition, analysis.normalized);
    if (token === null) {
      continue;
    }
    const image = analysis.normalized.slice(token.offset, token.offset + token.length).startsWith("[*");
    edits.push({ range: token, text: image ? `[*${newName}*]` : `[${newName}]` });
  }

  return edits;
}

/**
 * Reference-health issues beyond the parser's own lint: a definition
 * that is never used (Hint) and a redefinition of the same name
 * (Warning - the last one wins, like Texy reference resolution).
 * The shape matches @gryphoon/texy's LintIssue.
 * @param {Array<{ name: string }>} uses
 * @param {Array<{ reference: string, range: ?{ offset: number, length: number } }>} definitionNodes
 * @returns {Array<{ range: ?{ offset: number, length: number }, message: string, severity: number, code: string }>}
 */
export function referenceIssues(uses, definitionNodes) {
  const used = new Set(uses.map(u => u.name.toLowerCase()));
  const occurrences = new Map();
  const last = new Map();
  const issues = [];

  definitionNodes.forEach((definition, index) => {
    const key = definition.reference.toLowerCase();
    const count = occurrences.get(key) ?? 0;
    occurrences.set(key, count + 1);
    if (count > 0 && definition.range !== null) {
      issues.push({
        range: definition.range,
        message: `Duplicate definition of reference "${definition.reference}" - the last one wins.`,
        severity: 2, // Warning
        code: "reference/duplicate",
      });
    }
    last.set(key, { definition, index });
  });

  for (const { definition } of last.values()) {
    if (!used.has(definition.reference.toLowerCase()) && definition.range !== null) {
      issues.push({
        range: definition.range,
        message: `Reference "${definition.reference}" is defined but never used.`,
        severity: 4, // Hint
        code: "reference/unused",
      });
    }
  }

  return issues;
}
