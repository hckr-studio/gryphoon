/**
 * Shifts heading levels by the top setting and generates heading IDs
 * (transform phase, after HTML sanitizing), for a document in any language.
 * Port of Texy\Passes\HeadingPass; the level balancing and the {toc: ...}
 * hoisting live in HeadingModule::processHeadings, which runs earlier.
 */

import { webalize } from "../helpers.js";
import { extractText } from "../NodeHelpers.js";
import { NodeTraverser, DontTraverseChildren } from "../NodeTraverser.js";
import { HeadingNode, VerbatimBlockNode } from "../nodes.js";

export class HeadingPass {
  /**
   * @param {number} top level of the top heading (1..6)
   * @param {boolean} generateID
   * @param {string} idPrefix
   */
  constructor(top = 1, generateID = false, idPrefix = "toc-") {
    this.top = top;
    this.generateID = generateID;
    this.idPrefix = idPrefix;
  }

  /** @param {import('../nodes.js').DocumentNode} doc */
  process(doc) {
    const headings = collectHeadings(doc);

    for (const node of headings) {
      node.level = Math.min(6, Math.max(1, node.level + this.top - 1));
    }

    if (!this.generateID) {
      return;
    }

    const usedID = {};
    for (const node of headings) {
      if (node.modifier?.id) {
        // an explicit ID wins and reserves the name
        usedID[node.modifier.id] = true;
        node.id = node.modifier.id;
        continue;
      }

      // runs before typography, so the slug does not depend on it
      const id = HeadingPass.uniqueID(this.idPrefix + webalize(getTitle(node)), usedID);
      usedID[id] = true;
      node.id = id;
    }
  }

  /**
   * Moves the {toc: ...} label out of the modifier; it is transport syntax
   * and must never reach the output.
   * @param {HeadingNode} node
   */
  static hoistOverride(node) {
    if (!node.modifier || !Object.hasOwn(node.modifier.styles, "toc")) {
      return null;
    }

    const title = node.modifier.styles.toc;
    delete node.modifier.styles.toc;
    return title;
  }

  /** @param {Object<string, boolean>} usedID */
  static uniqueID(id, usedID) {
    if (!Object.hasOwn(usedID, id)) {
      return id;
    }

    let counter = 2;
    while (Object.hasOwn(usedID, id + "-" + counter)) {
      counter++;
    }

    return id + "-" + counter;
  }
}

/**
 * The heading's title: the {toc:} override, else the plain text content.
 * @param {HeadingNode} node
 */
export function getTitle(node) {
  return node.titleOverride ?? extractText(node).trim();
}

/**
 * Headings in document order, skipping code blocks (the pre-parsed content
 * of /--texysource samples is not part of the document outline).
 * @param {import('../nodes.js').Node} root
 * @returns {HeadingNode[]}
 */
export function collectHeadings(root) {
  const headings = [];
  new NodeTraverser().traverse(root, node => {
    if (node instanceof VerbatimBlockNode) {
      // the reference getHeadings does not traverse into verbatim blocks,
      // so /--texysource samples keep their written levels
      return DontTraverseChildren;
    }

    if (node instanceof HeadingNode) {
      headings.push(node);
    }

    return null;
  });

  return headings;
}
