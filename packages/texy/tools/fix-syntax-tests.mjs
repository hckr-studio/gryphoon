import { readFileSync, writeFileSync } from 'node:fs';

let s = readFileSync('tests/syntax.test.js', 'utf8');

const fixes = [
	// reference resolution (part of parse() now): [ref] urls resolve to the inner text
	["		assert.equal(link.url, '[http://texy.info]'); // bracket form is kept for reference resolution",
	 "		assert.equal(link.url, 'http://texy.info'); // [ref] resolution: no definition -> inner text as URL"],
	["		assert.equal(link.url, 'target'); // bracket form is kept",
	 "		assert.equal(link.url, 'target'); // [ref] resolution: no definition -> inner text as URL"],
	["		assert.ok(link instanceof LinkNode);\n		assert.equal(link.url, '[ref]');\n		assert.equal(link.ref, 'ref');",
	 "		assert.ok(link instanceof LinkNode);\n		assert.equal(link.url, 'ref'); // [ref] resolution: no definition -> inner text as URL\n		assert.equal(link.ref, 'ref');"],
	["		assert.equal(link.url, '[http://big.jpg]'); // bracket form is kept for reference resolution",
	 "		assert.equal(link.url, 'http://big.jpg'); // [ref] resolution"],
	// heading level balancing is part of parse()
	["		assert.equal(blocks[0].level, 4); // 7 - min(7, max(2, 3)) = 4",
	 "		assert.equal(blocks[0].level, 1); // balanced: 4 + (top - min) = 1"],
	["		assert.equal(blocks[0].level, 2); // preliminary: '=' => 2",
	 "		assert.equal(blocks[0].level, 1); // balanced: rank('=') + top = 1"],
	// directives: texy: directives are consumed by the transform pass
	["	it('{{name: arg, arg}} parses with content', () => {\n		const [para] = parse('{{texy: nofollow}}');\n		const node = findFirst(para, n => n instanceof DirectiveNode);\n		const parsed = node.parseContent();\n		assert.equal(parsed.name, 'texy');\n		assert.deepEqual(parsed.args, ['nofollow']);\n	});",
	 "	it('{{name: arg, arg}} parses with content', () => {\n		const texy = new Texy();\n		const doc = texy.parse('{{texy: nofollow}}');\n		assert.equal(doc.meta.nofollow, true); // consumed into document meta\n		assert.equal(findFirst(doc, n => n instanceof DirectiveNode), null); // and removed from the tree\n\n		const [para] = parse('{{mydirective: arg1, arg2}}');\n		const node = findFirst(para, n => n instanceof DirectiveNode); // unknown -> stays\n		const parsed = node.parseContent();\n		assert.equal(parsed.name, 'mydirective');\n		assert.deepEqual(parsed.args, ['arg1', 'arg2']);\n	});"],
	// emoticons: resolution fills .resolved
	["		const [on] = parse(':-)', { emoticon: true });\n		assert.ok(on.content.children[0] instanceof EmoticonNode);\n		assert.equal(on.content.children[0].emoticon, ':-)');",
	 "		const [on] = parse(':-)', { emoticon: true });\n		assert.ok(on.content.children[0] instanceof EmoticonNode);\n		assert.equal(on.content.children[0].emoticon, ':-)');\n		assert.equal(on.content.children[0].resolved, '\\u{1F642}'); // filled by the transform pass"],
	["		const node = para.content.children[0];\n		assert.ok(node instanceof EmoticonNode);\n		assert.equal(node.emoticon, ':-)');",
	 "		const node = para.content.children[0];\n		assert.ok(node instanceof EmoticonNode);\n		assert.equal(node.emoticon, ':-)');\n		assert.equal(node.resolved, '\\u{1F642}');"],
];

for (const [bad, good] of fixes) {
	if (!s.includes(bad)) {
		console.log('NOT FOUND:', JSON.stringify(bad.slice(0, 80)));
		continue;
	}
	s = s.split(bad).join(good);
}

// the {{name}} test needs Texy + findFirst(doc) - check imports exist
if (!s.includes("import { Texy } from '../src/Texy.js';")) {
	s = s.replace("import { Texy } from '../src/Texy.js';", "import { Texy } from '../src/Texy.js';"); // already there? it imports Texy at top
}

writeFileSync('tests/syntax.test.js', s);
console.log('done');
