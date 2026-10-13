/**
 * Isolated tests for the parsing engine - ported from
 * tests/Texy/InlineParser.phpt and tests/Texy/BlockParser.phpt.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContentNode, PhraseNode, TextNode, BlockNode } from '../src/nodes.js';
import { Range } from '../src/Range.js';
import { InlineParser } from '../src/Parsing/InlineParser.js';
import { BlockParser } from '../src/Parsing/BlockParser.js';
import { ParseContext } from '../src/Parsing/ParseContext.js';

/** Simple block node for testing. */
class TestBlockNode extends BlockNode
{
	constructor(type, content = '')
	{
		super();
		this.type = type;
		this.content = content;
	}


	getChildren()
	{
		return [];
	}
}


/** Gap node for capturing text between matches. */
class GapNode extends BlockNode
{
	constructor(content)
	{
		super();
		this.content = content;
	}


	getChildren()
	{
		return [];
	}
}


const blockHandler = type => (context, matches) => new TestBlockNode(type, matches[0]);
const gapHandler = (context, text) => text !== '' ? [new GapNode(text)] : [];
const nullHandler = () => null;
const phraseHandler = type => (context, matches, offsets) => new PhraseNode(
	new ContentNode([new TextNode(matches[1], new Range(offsets[1] ?? offsets[0], matches[1].length))]),
	type,
	null,
	new Range(offsets[0], matches[0].length),
);


/** Creates a block parser with a context and parses text. */
function parseWithBlockParser(patterns, text)
{
	const inlineParser = new InlineParser(new Map());
	const blockParser = new BlockParser(new Map(Object.entries(patterns)), gapHandler);
	const context = new ParseContext(inlineParser, blockParser);
	return blockParser.parse(context, text).children;
}


describe('InlineParser', () => {
	it('simple pattern match', () => {
		const parser = new InlineParser(new Map([
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
		]));

		const nodes = parser.parse(null, 'Hello **world** today');
		assert.deepEqual(nodes.children.map(n => [n.constructor.name, n.text ?? n.type]), [
			['TextNode', 'Hello '],
			['PhraseNode', 'phrase/strong'],
			['TextNode', ' today'],
		]);
	});

	it('multiple patterns without overlap', () => {
		const parser = new InlineParser(new Map([
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
			['italic', { pattern: String.raw`~//(.+?)//~`, handler: phraseHandler('phrase/em') }],
		]));

		const nodes = parser.parse(null, '**bold** and //italic//');
		assert.deepEqual(nodes.children.map(n => [n.constructor.name, n.text ?? n.type]), [
			['PhraseNode', 'phrase/strong'],
			['TextNode', ' and '],
			['PhraseNode', 'phrase/em'],
		]);
	});

	it('longer match wins at same offset', () => {
		const parser = new InlineParser(new Map([
			['short', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
			['long', { pattern: String.raw`~\*\*\*(.+?)\*\*\*~`, handler: phraseHandler('phrase/strong+em') }],
		]));

		const nodes = parser.parse(null, '***bold***');
		assert.equal(nodes.children.length, 1);
		assert.equal(nodes.children[0].type, 'phrase/strong+em');
	});

	it('same offset and length - first registered wins', () => {
		const parser = new InlineParser(new Map([
			['first', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('first-handler') }],
			['second', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('second-handler') }],
		]));

		const nodes = parser.parse(null, '**text**');
		assert.equal(nodes.children.length, 1);
		assert.equal(nodes.children[0].type, 'first-handler');
	});

	it('overlapping matches - earlier offset wins', () => {
		const parser = new InlineParser(new Map([
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
		]));

		const nodes = parser.parse(null, '**bold *overlap** end*');
		assert.equal(nodes.children.length, 2);
		assert.ok(nodes.children[0] instanceof PhraseNode);
		assert.ok(nodes.children[1] instanceof TextNode);
		assert.equal(nodes.children[1].text, ' end*');
	});

	it('handler returns null keeps the text literal', () => {
		const parser = new InlineParser(new Map([
			['image', { pattern: String.raw`~\[\*(.+?)\*\]~`, handler: nullHandler }],
		]));

		const nodes = parser.parse(null, '[*obr*]');
		assert.deepEqual(nodes.children.map(n => n.text), ['[*obr*]']);
	});

	it('null allows inner patterns to match', () => {
		const parser = new InlineParser(new Map([
			['outer', { pattern: String.raw`~\[(.+?)\]~`, handler: nullHandler }],
			['italic', { pattern: String.raw`~\*(.+?)\*~`, handler: phraseHandler('phrase/em') }],
		]));

		const nodes = parser.parse(null, '[*text*]');
		assert.deepEqual(nodes.children.map(n => [n.constructor.name, n.text ?? n.type]), [
			['TextNode', '['],
			['PhraseNode', 'phrase/em'],
			['TextNode', ']'],
		]);
	});

	it('null tries alternative pattern at same position', () => {
		let secondHandlerCalled = false;
		const parser = new InlineParser(new Map([
			['first', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: nullHandler }],
			['second', {
				pattern: String.raw`~\*\*(.+?)\*\*~`,
				handler: (context, matches, offsets) => {
					secondHandlerCalled = true;
					return new PhraseNode(new ContentNode([new TextNode(matches[1])]), 'second');
				},
			}],
		]));

		const nodes = parser.parse(null, '**text**');
		assert.ok(secondHandlerCalled);
		assert.equal(nodes.children.length, 1);
		assert.equal(nodes.children[0].type, 'second');
	});

	it('null does not block non-overlapping patterns', () => {
		const parser = new InlineParser(new Map([
			['broken', { pattern: String.raw`~\[x\]~`, handler: nullHandler }],
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
		]));

		const nodes = parser.parse(null, '[x] **works**');
		assert.deepEqual(nodes.children.map(n => [n.constructor.name, n.text ?? n.type]), [
			['TextNode', '[x] '],
			['PhraseNode', 'phrase/strong'],
		]);
	});

	it('positions are correct', () => {
		const parser = new InlineParser(new Map([
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
		]));

		const nodes = parser.parse(null, 'aa**bb**cc');
		assert.deepEqual(nodes.children.map(n => [n.range.offset, n.range.length]), [[0, 2], [2, 6], [8, 2]]);
	});

	it('base offset is applied', () => {
		const parser = new InlineParser(new Map([
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
		]));

		const nodes = parser.parse(null, 'aa**bb**cc', 100);
		assert.deepEqual(nodes.children.map(n => n.range.offset), [100, 102, 108]);
	});

	it('capture group offsets passed to handler', () => {
		let receivedOffsets = null;
		const parser = new InlineParser(new Map([
			['test', {
				pattern: String.raw`~(\*\*)(.+?)(\*\*)~`,
				handler: (context, matches, offsets) => {
					receivedOffsets = offsets;
					return new TextNode(matches[2]);
				},
			}],
		]));

		parser.parse(null, '**test**');
		assert.deepEqual(receivedOffsets, [0, 0, 2, 6]);
	});

	it('handler receives correct pattern name', () => {
		let receivedName = null;
		const parser = new InlineParser(new Map([
			['my/custom-pattern', {
				pattern: String.raw`~\*\*(.+?)\*\*~`,
				handler: (context, matches, offsets, name) => {
					receivedName = name;
					return new TextNode(matches[1]);
				},
			}],
		]));

		parser.parse(null, '**text**');
		assert.equal(receivedName, 'my/custom-pattern');
	});

	it('empty text returns empty ContentNode', () => {
		const parser = new InlineParser(new Map([
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
		]));

		const nodes = parser.parse(null, '');
		assert.ok(nodes instanceof ContentNode);
		assert.deepEqual(nodes.children, []);
	});

	it('no pattern matches returns single TextNode', () => {
		const parser = new InlineParser(new Map([
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~`, handler: phraseHandler('phrase/strong') }],
		]));

		const nodes = parser.parse(null, 'plain text');
		assert.deepEqual(nodes.children.map(n => n.text), ['plain text']);
	});

	it('no patterns registered returns single TextNode', () => {
		const parser = new InlineParser(new Map());
		const nodes = parser.parse(null, 'some text');
		assert.deepEqual(nodes.children.map(n => n.text), ['some text']);
	});

	it('addPattern method works', () => {
		const parser = new InlineParser(new Map());
		parser.addPattern('bold', String.raw`~\*\*(.+?)\*\*~`, phraseHandler('phrase/strong'));

		const nodes = parser.parse(null, '**text**');
		assert.equal(nodes.children.length, 1);
		assert.equal(nodes.children[0].type, 'phrase/strong');
	});

	it('UTF-8 content in match', () => {
		const parser = new InlineParser(new Map([
			['bold', { pattern: String.raw`~\*\*(.+?)\*\*~u`, handler: phraseHandler('phrase/strong') }],
		]));

		const nodes = parser.parse(null, 'Hello **日本語** world');
		assert.equal(nodes.children.length, 3);
		assert.ok(nodes.children[0] instanceof TextNode);
		assert.ok(nodes.children[1] instanceof PhraseNode);
		assert.ok(nodes.children[2] instanceof TextNode);
		assert.equal(nodes.children[0].text, 'Hello ');
		assert.equal(nodes.children[1].content.children[0].text, '日本語');
		assert.equal(nodes.children[2].text, ' world');
	});

	it('optional capture group that matches and one that does not', () => {
		let received = null;
		const parser = new InlineParser(new Map([
			['test', {
				pattern: String.raw`~\*\*(.+?)(\s+mod)?\*\*~`,
				handler: (context, matches, offsets) => {
					received = { matches, offsets };
					return new TextNode(matches[1]);
				},
			}],
		]));

		parser.parse(null, '**text mod**');
		assert.equal(received.matches[2], ' mod');

		parser.parse(null, '**text**');
		assert.equal(received.matches[2], null);
		assert.equal(received.offsets[2], null);
	});
});


describe('BlockParser', () => {
	it('simple pattern match', () => {
		const nodes = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: blockHandler('heading') },
		}, '# Title\n');
		assert.equal(nodes.length, 1);
		assert.equal(nodes[0].type, 'heading');
	});

	it('multiple different patterns', () => {
		const nodes = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: blockHandler('heading') },
			rule: { pattern: String.raw`~^---~m`, handler: blockHandler('rule') },
		}, '# Title\n---\n');
		assert.deepEqual(nodes.map(n => n.type), ['heading', 'rule']);
	});

	it('multiple matches of same pattern', () => {
		const nodes = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: blockHandler('heading') },
		}, '# One\n# Two\n# Three\n');
		assert.deepEqual(nodes.map(n => n.type), ['heading', 'heading', 'heading']);
	});

	it('text before match goes to gapHandler', () => {
		const nodes = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: blockHandler('heading') },
		}, 'paragraph\n# Title\n');
		assert.equal(nodes.length, 2);
		assert.ok(nodes[0] instanceof GapNode);
		assert.equal(nodes[0].content, 'paragraph\n');
		assert.equal(nodes[1].type, 'heading');
	});

	it('text after match goes to gapHandler (trailing newlines trimmed)', () => {
		const nodes = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: blockHandler('heading') },
		}, '# Title\nparagraph\n');
		assert.equal(nodes.length, 2);
		assert.equal(nodes[0].type, 'heading');
		assert.ok(nodes[1] instanceof GapNode);
		assert.equal(nodes[1].content, 'paragraph');
	});

	it('only text without matches', () => {
		const nodes = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: blockHandler('heading') },
		}, 'just text\n');
		assert.equal(nodes.length, 1);
		assert.ok(nodes[0] instanceof GapNode);
		assert.equal(nodes[0].content, 'just text');
	});

	it('earlier registered pattern wins at same offset', () => {
		let firstCalled = false;
		let secondCalled = false;
		const nodes = parseWithBlockParser({
			first: { pattern: String.raw`~^\#[ ](.+)~m`, handler: () => (firstCalled = true, new TestBlockNode('first')) },
			second: { pattern: String.raw`~^\#[ ](.+)~m`, handler: () => (secondCalled = true, new TestBlockNode('second')) },
		}, '# Title\n');
		assert.ok(firstCalled);
		assert.ok(!secondCalled);
		assert.equal(nodes.length, 1);
		assert.equal(nodes[0].type, 'first');
	});

	it('null handler tries next pattern at same position', () => {
		let secondCalled = false;
		const nodes = parseWithBlockParser({
			rejecting: { pattern: String.raw`~^\#[ ](.+)~m`, handler: nullHandler },
			accepting: { pattern: String.raw`~^\#[ ](.+)~m`, handler: () => (secondCalled = true, new TestBlockNode('accepted')) },
		}, '# Title\n');
		assert.ok(secondCalled);
		assert.deepEqual(nodes.map(n => n.type), ['accepted']);
	});

	it('all handlers return null - text goes to gapHandler', () => {
		const nodes = parseWithBlockParser({
			rejecting: { pattern: String.raw`~^\#[ ](.+)~m`, handler: nullHandler },
		}, '# Title\n');
		assert.equal(nodes.length, 1);
		assert.ok(nodes[0] instanceof GapNode);
		assert.equal(nodes[0].content, '# Title');
	});

	it('handler uses next() to consume multiple lines', () => {
		const nodes = parseWithBlockParser({
			list: {
				pattern: String.raw`~^-[ ](.+)~m`,
				handler: (context, matches) => {
					const items = [matches[1]];
					let m;
					while ((m = context.getBlockParser().next(String.raw`~^-[ ](.+)~`)) !== null) {
						items.push(m.matches[1]);
					}
					return new TestBlockNode('list', items.join(','));
				},
			},
		}, '- one\n- two\n- three\n');
		assert.deepEqual(nodes.map(n => [n.type, n.content]), [['list', 'one,two,three']]);
	});

	it('next() returns null at end of text', () => {
		let nextResult;
		parseWithBlockParser({
			test: {
				pattern: String.raw`~^test~m`,
				handler: (context) => {
					nextResult = context.getBlockParser().next(String.raw`~^more~`);
					return new TestBlockNode('test');
				},
			},
		}, 'test\n');
		assert.equal(nextResult, null);
	});

	it('next() advances position correctly', () => {
		const nodes = parseWithBlockParser({
			block: {
				pattern: String.raw`~^start~m`,
				handler: (context) => {
					context.getBlockParser().next(String.raw`~^middle~`);
					return new TestBlockNode('block'); // "after" goes to the gap handler
				},
			},
		}, 'start\nmiddle\nafter\n');
		assert.deepEqual(nodes.map(n => [n.type, n.content]), [['block', ''], [undefined, 'after']]);
	});

	it('moveBackward allows next pattern to match', () => {
		const nodes = parseWithBlockParser({
			quote: {
				pattern: String.raw`~^>[ ](.+)~m`,
				handler: (context, matches) => {
					const lines = [matches[1]];
					let m;
					while ((m = context.getBlockParser().next(String.raw`~^(.+)~`)) !== null) {
						if (!m.matches[0].startsWith('> ')) {
							context.getBlockParser().moveBackward();
							break;
						}
						lines.push(m.matches[0].slice(2));
					}
					return new TestBlockNode('quote', lines.join('\n'));
				},
			},
			other: { pattern: String.raw`~^other~m`, handler: blockHandler('other') },
		}, '> quote1\n> quote2\nother\n');
		assert.deepEqual(nodes.map(n => [n.type, n.content]), [['quote', 'quote1\nquote2'], ['other', 'other']]);
	});

	it('empty text returns empty array', () => {
		const nodes = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: blockHandler('heading') },
		}, '');
		assert.deepEqual(nodes, []);
	});

	it('no patterns registered', () => {
		const nodes = parseWithBlockParser({}, 'text\n');
		assert.equal(nodes.length, 1);
		assert.ok(nodes[0] instanceof GapNode);
		assert.equal(nodes[0].content, 'text');
	});

	it('handler receives correct pattern name', () => {
		let receivedName = null;
		parseWithBlockParser({
			'my/custom-pattern': {
				pattern: String.raw`~^test~m`,
				handler: (context, matches, offsets, name) => {
					receivedName = name;
					return new TestBlockNode('test');
				},
			},
		}, 'test\n');
		assert.equal(receivedName, 'my/custom-pattern');
	});

	it('handler receives offsets', () => {
		let receivedOffsets = null;
		parseWithBlockParser({
			test: {
				pattern: String.raw`~^(prefix)(.+)~m`,
				handler: (context, matches, offsets) => {
					receivedOffsets = offsets;
					return new TestBlockNode('test');
				},
			},
		}, 'prefixcontent\n');
		assert.deepEqual(receivedOffsets, [0, 0, 6]);
	});

	it('block node positions are correct', () => {
		const withRange = type => (context, matches, offsets) => {
			const node = new TestBlockNode(type, matches[0]);
			node.range = new Range(offsets[0], matches[0].length);
			return node;
		};
		const nodes = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: withRange('heading') },
		}, '# One\n# Two\n');
		assert.deepEqual(nodes.map(n => [n.range.offset, n.range.length]), [[0, 5], [6, 5]]);

		const nodes2 = parseWithBlockParser({
			heading: { pattern: String.raw`~^\#[ ](.+)~m`, handler: withRange('heading') },
		}, 'text\n# Title\n');
		assert.equal(nodes2[1].range.offset, 5);
	});

	it('multi-line block position with next()', () => {
		const nodes = parseWithBlockParser({
			list: {
				pattern: String.raw`~^-[ ](.+)~m`,
				handler: (context, matches, offsets) => {
					const startOffset = offsets[0];
					let totalLength = matches[0].length;
					let m;
					while ((m = context.getBlockParser().next(String.raw`~^-[ ](.+)~`)) !== null) {
						totalLength += 1 + m.length;
					}
					const node = new TestBlockNode('list', 'items');
					node.range = new Range(startOffset, totalLength);
					return node;
				},
			},
		}, '- one\n- two\n- three\n');
		assert.deepEqual([nodes[0].range.offset, nodes[0].range.length], [0, 19]);
	});

	it('handler returns ContentNode - children are spliced into the result', () => {
		const nodes = parseWithBlockParser({
			double: {
				pattern: String.raw`~^double~m`,
				handler: () => new ContentNode([new TestBlockNode('one'), new TestBlockNode('two')]),
			},
		}, 'double\n');
		assert.deepEqual(nodes.map(n => n.type), ['one', 'two']);
	});

	it('empty ContentNode consumes the match without emitting anything', () => {
		const nodes = parseWithBlockParser({
			collector: {
				pattern: String.raw`~^\[def][ ](.+)~m`,
				handler: () => new ContentNode,
			},
		}, 'before\n[def] url\nafter\n');
		assert.deepEqual(nodes.map(n => n.content), ['before\n', 'after']);
	});

	it('getNodes() shows previous blocks including gap output', () => {
		let seen = null;
		parseWithBlockParser({
			rule: {
				pattern: String.raw`~^---~m`,
				handler: (context) => {
					seen = context.getBlockParser().getNodes();
					return new TestBlockNode('rule');
				},
			},
		}, 'paragraph\n---\n');
		assert.equal(seen.length, 1);
		assert.ok(seen[0] instanceof GapNode);
		assert.equal(seen[0].content, 'paragraph\n');
	});

	it('getNodes() is empty for the first block', () => {
		let seen;
		parseWithBlockParser({
			rule: {
				pattern: String.raw`~^---~m`,
				handler: (context) => {
					seen = context.getBlockParser().getNodes();
					return new TestBlockNode('rule');
				},
			},
		}, '---\ntext\n');
		assert.deepEqual(seen, []);
	});

	it('nested parseBlock() has its own node list', () => {
		let outer, innerResult;
		parseWithBlockParser({
			wrapper: {
				pattern: String.raw`~^wrap:[ ](.+)~m`,
				handler: (context, matches) => {
					innerResult = context.parseBlock(matches[1]).children;
					outer = context.getBlockParser().getNodes(); // nested parse must not touch this list
					return new TestBlockNode('wrapper');
				},
			},
		}, 'first\nwrap: inner text\n');
		assert.equal(innerResult.length, 1);
		assert.equal(innerResult[0].content, 'inner text');
		assert.equal(outer.length, 1);
		assert.ok(outer[0] instanceof GapNode);
	});

	it('trailing newlines do not produce a phantom empty line for next()', () => {
		const lines = [];
		parseWithBlockParser({
			fence: {
				pattern: '~^' + '```' + '~m',
				handler: (context) => {
					let m;
					while ((m = context.getBlockParser().next(String.raw`~[^\n]*~`)) !== null) {
						lines.push(m.matches[0]);
					}
					return new TestBlockNode('fence');
				},
			},
		}, '```\ncode\n');
		assert.deepEqual(lines, ['code']);
	});

	it('empty line inside the text still reaches next()', () => {
		const lines = [];
		parseWithBlockParser({
			fence: {
				pattern: '~^' + '```' + '~m',
				handler: (context) => {
					let m;
					while ((m = context.getBlockParser().next(String.raw`~[^\n]*~`)) !== null) {
						lines.push(m.matches[0]);
					}
					return new TestBlockNode('fence');
				},
			},
		}, '```\na\n\nb\n');
		assert.deepEqual(lines, ['a', '', 'b']);
	});
});
