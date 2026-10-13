/**
 * Texy 3 reference semantics (linkModule.legacyReferences), restored
 * for historical documents: definitions carry a label and a modifier
 * (the 4-dev reference deprecates and ignores them), reference URLs
 * may contain %s, and image definitions' modifiers apply to [*img*]
 * link targets.
 *
 * Expected values verified against the actual Texy 3.2.8 (the
 * reference implementation of the semantics, extracted from this
 * repo's git tags) with the identical inputs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Texy } from '../src/Texy.js';

/** A Texy with both flags on: bare [ref] + the Texy 3 semantics. */
function texy3()
{
	const texy = new Texy();
	texy.allowed['link/reference'] = true;
	texy.linkModule.legacyReferences = true;
	return texy;
}

describe('Texy 3 references: definition label', () => {
	it('the legacy flag alone enables the bare [ref] syntax (Texy 3 always allowed it)', () => {
		const texy = new Texy();
		texy.linkModule.legacyReferences = true;
		assert.equal(
			texy.process('[l]: http://e.com/ label\n\nuse [l]'),
			'<p>use <a href="http://e.com/">label</a></p>\n');
	});
	it('the label becomes the content of a bare [ref], inline parsed', () => {
		assert.equal(
			texy3().process('[d]: http://e.com/ **bold** and *em*\n\nuse [d]'),
			'<p>use <a href="http://e.com/"><strong>bold</strong> and <em>em</em></a></p>\n');
	});

	it('a label containing a reference resolves it (recursively; the nested <a> is suppressed)', () => {
		assert.equal(
			texy3().process('[inner]: http://inner.com/ inside\n[a]: http://e.com/ see [inner]\n\nuse [a]'),
			'<p>use <a href="http://e.com/">see inside</a></p>\n');
	});

	it('a circular label renders raw (the Texy 3 livelock)', () => {
		assert.equal(
			texy3().process('[x]: http://e.com/ [x]\n\nstart [x] end'),
			'<p>start <a href="http://e.com/">[x]</a> end</p>\n');
	});

	it('without a label a bare [ref] shows the shortened URL (the Texy 3 textualUrl)', () => {
		assert.equal(
			texy3().process('[c]: https://example.com/very-long-path/that/should-be/shortened\n\ngo [c] now'),
			'<p>go <a\nhref="https://example.com/very-long-path/that/should-be/shortened">https://example.com/…be/shortened</a>\nnow</p>\n');
	});

	it('the label is ignored for "text":[ref] uses (the display text lives at the use site)', () => {
		assert.equal(
			texy3().process('[l]: http://e.com/ just-a-label\n\ngo [l] and "x":[l]'),
			'<p>go <a href="http://e.com/">just-a-label</a> and <a\nhref="http://e.com/">x</a></p>\n');
	});

	it('an e-mail reference gains mailto: and shows its label', () => {
		assert.equal(
			texy3().process('[me]: dave@example.com David\n\nmail [me]'),
			'<p>mail <a href="mailto:dave&#64;example.com">David</a></p>\n');
	});
});

describe('Texy 3 references: definition modifier', () => {
	it('applies to every use site (bare and "text":[ref])', () => {
		assert.equal(
			texy3().process('[m]: http://e.com/ .(deftitle)[defcls]{color:red}\n\ngo [m] and "text":[m]'),
			'<p>go <a href="http://e.com/" title="deftitle" class="defcls"\n'
			+ 'style="color:red">http://e.com/</a> and <a href="http://e.com/" title="deftitle"\n'
			+ 'class="defcls" style="color:red">text</a></p>\n');
	});

	it('the use-site modifier wins on the title, classes union (definition first)', () => {
		assert.equal(
			texy3().process('[b]: http://example.org/ .(deftitle)[defcls]\n\n"text .(usertitle)[usercls]":[b]'),
			'<p><a href="http://example.org/" title="usertitle"\nclass="defcls usercls">text</a></p>\n');
	});

	it('the image definition modifier applies to a [*img*] link target', () => {
		assert.equal(
			texy3().process('[*img*]: http://e.com/pic.gif .(alt-title)[piccls]\n\nclick "[*img*]":[*img*]'),
			'<p>click <a href="http://e.com/pic.gif" title="alt-title" class="piccls"><img\nsrc="http://e.com/pic.gif" alt="alt-title"></a></p>\n');
	});

	it('by default (the flag off) the 4-dev behavior stays: modifiers are ignored', () => {
		const texy = new Texy();
		texy.allowed['link/reference'] = true;
		assert.equal(
			texy.process('[m]: http://e.com/ .(deftitle)[defcls]\n\ngo [m] and "text":[m]'),
			'<p>go <a href="http://e.com/">m</a> and <a href="http://e.com/">text</a></p>\n');
	});
});

describe('Texy 3 references: %s in reference URLs', () => {
	it('takes the use-site text, form-url-encoded', () => {
		assert.equal(
			texy3().process('[wiki]: https://wiki.example.com/search?q=%s\n\n"my page":[wiki]'),
			'<p><a href="https://wiki.example.com/search?q=my+page">my page</a></p>\n');
	});

	it("encodes ! ' ( ) ~ which encodeURIComponent leaves", () => {
		assert.equal(
			texy3().process('[w]: http://e.com/%s/page\n\n"a b & c":[w]'),
			'<p><a href="http://e.com/a+b+%26+c/page">a b &amp; c</a></p>\n');
	});

	it("deliberately deviates from PHP urlencode on '*': a valid URL sub-delim, stays literal", () => {
		assert.equal(
			texy3().process('[w]: http://e.com/%s/page\n\n"star * tip":[w]'),
			'<p><a href="http://e.com/star+*+tip/page">star * tip</a></p>\n');
	});

	it('a bare [ref] keeps the %s literal (no use-site text exists)', () => {
		assert.equal(
			texy3().process('[w]: http://e.com/%s/page\n\ngo [w]'),
			'<p>go <a href="http://e.com/%s/page">http://e.com/%s/page</a></p>\n');
	});
});

describe('Texy 3 references: the addDefinition API', () => {
	it('accepts a label and a modifier (the Texy 3 Link::$label / Link::$modifier)', () => {
		const texy = texy3();
		texy.linkModule.addDefinition('api', 'https://example.com/api', 'API **docs**', '.(The API)');
		assert.equal(
			texy.process('check [api]'),
			'<p>check <a href="https://example.com/api" title="The API">API\n<strong>docs</strong></a></p>\n');
	});
});

