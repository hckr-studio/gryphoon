/**
 * Tests for normalize() - ported from tests/Texy/normalize.phpt.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/normalize.js';

describe('normalize()', () => {
	it('line endings are converted to \\n', () => {
		assert.equal(normalize('a\r\nb\rc'), 'a\nb\nc');
	});

	it('leading byte order mark is removed', () => {
		assert.equal(normalize('\uFEFFtext'), 'text');
		assert.equal(normalize('\n\uFEFF\ntext'), 'text'); // surfaces after the blank-line trim
		assert.equal(normalize('te\uFEFFxt'), 'te\uFEFFxt'); // only the leading one
	});

	it('control characters are removed, tabs stay', () => {
		assert.equal(normalize('a\x00\x08\x0B\x1Fb'), 'ab');
		assert.equal(normalize('a\tb'), 'a\tb');
	});

	it('soft hyphens are preserved', () => {
		assert.equal(normalize('wo\u00ADrd'), 'wo\u00ADrd');
	});

	it('lines are right-trimmed', () => {
		assert.equal(normalize('a  \t\nb\t'), 'a\nb');
	});

	it('blank edge lines are dropped', () => {
		assert.equal(normalize('\n\n  \ntext\n \n\n'), 'text');
	});

	it('idempotence', () => {
		const dirty = '\uFEFF\r\n first\u00AD line  \r\nsecond\tline \x07\n\n';
		const clean = normalize(dirty);
		assert.equal(normalize(clean), clean);
	});

	it('invalid UTF-8 is rejected', () => {
		assert.throws(() => normalize('valid \uD83D invalid'), /not valid UTF-8/); // lone high surrogate
	});
});
