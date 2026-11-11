/**
 * Source range of an AST node.
 *
 * Offsets are UTF-16 code-unit indices into the normalized source string
 * (JS-native). The PHP reference counts bytes; the difference only matters
 * for non-ASCII text and is bridged by the test-suite dumpers. All offsets
 * in the engine are exact after parsing.
 */
import { NodeTraverser, StopTraversal } from "./NodeTraverser.js";

export class Range {
  /**
   * @param {number} offset 0-based offset, in UTF-16 code units
   * @param {number} length of the range, in UTF-16 code units
   */
  constructor(offset, length) {
    this.offset = offset;
    this.length = length;
  }
}

/**
 * The common base of all AST nodes.
 */
export class Node {
  /** @type {?Range} */
  range = null;

  /**
   * All nodes of the subtree of the given class the filter accepts, in pre-order.
   * @param {Function} cls a Node subclass
   * @param {?Function} filter (node: Node) => boolean
   * @returns {Array<Node>}
   */
  find(cls, filter = null) {
    const found = [];
    this.traverse(node => {
      if (node instanceof cls && (filter === null || filter(node))) {
        found.push(node);
      }
      return null;
    });
    return found;
  }

  /**
   * The first node of the class the filter accepts, pre-order.
   * @param {Function} cls a Node subclass
   * @param {?Function} filter (node: Node) => boolean
   * @returns {?Node}
   */
  findFirst(cls, filter = null) {
    let found = null;
    this.traverse(node => {
      if (node instanceof cls && (filter === null || filter(node))) {
        found = node;
        return StopTraversal;
      }
      return null;
    });
    return found;
  }

  /**
   * @param {?Function} enter (node) => Node|number|null
   * @param {?Function} leave (node) => Node|number|null
   * @returns {?Node}
   */
  traverse(enter = null, leave = null) {
    return new NodeTraverser().traverse(this, enter, leave);
  }

  /**
   * Plain-text content of the subtree (no markup).
   * @returns {string}
   */
  getPlainText() {
    let text = "";
    for (const child of this.getChildren()) {
      text += child.getPlainText();
    }
    return text;
  }

  /**
   * A deep copy: every node of the subtree is new, the modifiers are shared.
   * @returns {Node}
   */
  cloneNode() {
    const copy = Object.create(Object.getPrototypeOf(this));
    Object.assign(copy, this);
    for (const name of Object.keys(copy)) {
      const value = copy[name];
      if (value instanceof Node) {
        copy[name] = value.cloneNode();
      } else if (Array.isArray(value)) {
        copy[name] = value.map(item => (item instanceof Node ? item.cloneNode() : item));
      }
    }
    return copy;
  }
}
