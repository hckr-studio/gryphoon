#!/usr/bin/env node
/** Diff helper: shows the first difference between this port's AST dump and the oracle fixture. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Texy } from '../../src/Texy.js';
import { normalize } from '../../src/normalize.js';
import { dump } from './ast-dumper.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const name = process.argv[2];


const source = normalize(readFileSync(join(root, '..', '..', 'tests', 'Texy', 'sources', name + '.texy'), 'utf8'));
const expected = readFileSync(join(root, 'tests', 'fixtures', 'parse', name + '.txt'), 'utf8');

const texy = new Texy();
if (process.argv.includes('--emoticon')) texy.allowed.emoticon = true;

const actual = dump(texy.parse(source), source);
const a = actual.split('\n'), e = expected.split('\n');
let shown = 0;
for (let i = 0; i < Math.max(a.length, e.length) && shown < (parseInt(process.argv[4] ?? '3', 10)); i++) {
	if (a[i] !== e[i]) {
		console.log('diff at line', i + 1);
		console.log('  actual:  ', JSON.stringify(a.slice(i, i + 3)));
		console.log('  expected:', JSON.stringify(e.slice(i, i + 3)));
		shown++;
		i += 2;
	}
}
if (actual === expected) console.log('IDENTICAL');
