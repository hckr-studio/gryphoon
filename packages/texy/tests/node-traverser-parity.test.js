/**
 * NodeTraverser: parity with the pre-optimization formulation.
 *
 * The traversal was rewritten from materialized child slots (an array of
 * wrapper objects allocated per node) to structural dispatch on the
 * container fields. The original slot-materializing formulation is kept
 * here as the oracle: the same synthetic trees through both must agree -
 * including stop propagation between property slots (a table's caption
 * before its rows, a figure's image before its caption), node replacement,
 * and the PHP walk() pruning semantics.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeTraverser, DontTraverseChildren, StopTraversal, RemoveNode } from '../src/NodeTraverser.js';

const DontTraverseChildrenOracle = 1;
const StopTraversalOracle = 2;
const RemoveNodeOracle = 3;

/**
 * Child slots of every node shape: [container object, property or index] -
 * the original implementation, before the structural dispatch.
 * @param {Object} node
 */
function childSlots(node)
{
	switch (node.constructor.name) {
		case 'DocumentNode': return [{ container: node, key: 'content' }];
		case 'ContentNode': return node.children.map((child, index) => ({ container: node.children, key: index }));
		case 'FigureNode': return [{ container: node, key: 'image' }, ...(node.caption !== null ? [{ container: node, key: 'caption' }] : [])];
		case 'ListNode': case 'DefinitionListNode': return node.items.map((item, index) => ({ container: node.items, key: index }));
		case 'TableNode': return [...(node.caption !== null ? [{ container: node, key: 'caption' }] : []), ...node.rows.map((row, index) => ({ container: node.rows, key: index }))];
		case 'TableRowNode': return node.cells.map((cell, index) => ({ container: node.cells, key: index }));
		default: return node.content !== undefined ? [{ container: node, key: 'content' }] : [];
	}
}

class OracleTraverser
{
	traverse(node, enter = null, leave = null)
	{
		this.enter = enter;
		this.leave = leave;
		this.stop = false;
		return this.traverseNode(node);
	}

	traverseNode(node)
	{
		let children = true;
		if (this.enter) {
			const res = this.enter(node);
			if (res instanceof Object && res !== null && typeof res.getChildren === 'function') node = res;
			else if (res === DontTraverseChildrenOracle) children = false;
			else if (res === StopTraversalOracle) { this.stop = true; return node; }
			else if (res === RemoveNodeOracle) return null;
		}
		if (children) {
			for (const slot of childSlots(node)) {
				const subnode = slot.container[slot.key];
				if (subnode === undefined || subnode === null) continue;
				const res = this.traverseNode(subnode);
				if (res !== subnode) slot.container[slot.key] = res;
				if (this.stop) break;
			}
			for (const array of [node.children, node.items, node.rows, node.cells]) {
				if (Array.isArray(array)) {
					const filtered = array.filter(item => item !== null && item !== undefined);
					if (filtered.length !== array.length) { array.length = 0; array.push(...filtered); }
				}
			}
		}
		if (!this.stop && this.leave) {
			const res = this.leave(node);
			if (res instanceof Object && res !== null && typeof res.getChildren === 'function') node = res;
			else if (res === StopTraversalOracle) this.stop = true;
			else if (res === RemoveNodeOracle) return null;
		}
		return node;
	}
}

/** Synthetic node: constructor-name dispatchable, getChildren-capable. */
function mk(name, props = {})
{
	return { constructor: { name }, getChildren() { return []; }, ...props };
}

/** A tree covering every slot shape. */
function buildTree()
{
	return mk('DocumentNode', { content: mk('ContentNode', {
		children: [
			mk('TextNode'),
			mk('ContentNode', { children: [mk('EmNode'), mk('StrongNode')] }),
			mk('ListNode', { items: [mk('ItemNode'), mk('ItemNode2'), mk('ItemNode3')] }),
			mk('TableNode', { caption: mk('CapNode'), rows: [mk('RowNode'), mk('RowNode2')] }),
			mk('FigureNode', { image: mk('ImgNode'), caption: mk('FigCapNode') }),
			mk('FigureNode', { image: mk('ImgNode2'), caption: null }),
			mk('TableRowNode', { cells: [mk('CellNode'), mk('CellNode2')] }),
			mk('GenericNode', { content: mk('DeepNode') }),
			mk('LeafNode'),
			null,
		],
	}) });
}

const serialize = v => JSON.stringify(v, (k, x) => typeof x === 'function' ? undefined : x);

const scenarios = [
	['plain visit', () => null],
	['remove every second node', node => node.constructor.name.endsWith('2') || node.constructor.name === 'ItemNode' ? RemoveNode : null],
	['stop at RowNode', node => node.constructor.name === 'RowNode' ? StopTraversal : null],
	['stop at a table caption slot', node => node.constructor.name === 'CapNode' ? StopTraversal : null],
	['stop at a figure image slot', node => node.constructor.name === 'ImgNode' ? StopTraversal : null],
	['do not traverse ContentNode children', node => node.constructor.name === 'ContentNode' ? DontTraverseChildren : null],
	['enter replaces a node', node => node.constructor.name === 'EmNode' ? mk('ReplacedNode') : null],
	['leave removes', null, node => node.constructor.name === 'ItemNode2' ? RemoveNode : null],
	['leave stops', null, node => node.constructor.name === 'StrongNode' ? StopTraversal : null],
	['remove a caption', node => node.constructor.name === 'CapNode' ? RemoveNode : null],
	['remove a figure image', node => node.constructor.name === 'ImgNode' ? RemoveNode : null],
];

describe('NodeTraverser parity with the slot-materializing formulation', () => {
	for (const [label, enter, leave] of scenarios) {
		it(label, () => {
			const oracleResult = new OracleTraverser().traverse(buildTree(), enter, leave);
			const result = new NodeTraverser().traverse(buildTree(), enter, leave);
			assert.strictEqual(serialize(result), serialize(oracleResult), label);
		});
	}

	it('visit order is pre-order and identical', () => {
		const collect = TraverserClass => {
			const seen = [];
			new TraverserClass().traverse(buildTree(), node => { seen.push(node.constructor.name); return null; });
			return seen.join(',');
		};
		assert.strictEqual(collect(NodeTraverser), collect(OracleTraverser));
	});
});
