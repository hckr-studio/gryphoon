<?php declare(strict_types=1);

/**
 * Differential corpus for the PCRE->JS translator: registers the reference
 * implementation's real parse-phase patterns, runs them against sample
 * subjects (all tests/Texy/sources/*.texy plus feature-specific snippets)
 * and dumps every match with capture offsets as JSON.
 *
 * The Node.js test suite replays the corpus through src/Regexp.js and
 * asserts identical matches and offsets (byte -> code-unit converted).
 *
 * Usage: php tools/regexp-corpus.php > tests/fixtures/regexp-corpus.json
 */

error_reporting(E_ALL & ~E_DEPRECATED);
ini_set('pcre.jit', '0');
ini_set('pcre.backtrack_limit', '100000000');
ini_set('pcre.recursion_limit', '1000000');

require __DIR__ . '/autoloader.php';

use Texy\Regexp;
use Texy\Texy;

function patternsOf(string $property, string $method): array
{
	$texy = new Texy;
	foreach ($texy->getModules() as $module) {
		$module->beforeParse();
	}

	$engine = new ReflectionProperty(Texy::class, 'engine');
	$engine->setAccessible(true);
	$engineProp = $engine->getValue($texy);

	$prop = new ReflectionProperty('\\Texy\\Parsing\\Engine', $property);
	$prop->setAccessible(true);

	$patterns = [];
	foreach ($prop->getValue($engineProp) as $name => $info) {
		$patterns[$name] = $info['pattern'];
	}
	return $patterns;
}


$subjects = array_map(
	fn($f) => (string) file_get_contents($f),
	glob(__DIR__ . '/../../../tests/Texy/sources/*.texy'),
);

// feature-specific snippets for the translator's edge cases
$subjects = array_merge($subjects, [
	'a  b',
	"\xc2\xa0nbsp and\ttab", // NBSP: PCRE \s must NOT match it
	'**bold** and //italic// and ***both***',
	'"quoted .(title)[class]{color: red}<>" ~span~',
	'[* img.jpg 100x200 .(alt)> *]:link *** caption',
	'NATO((North Atlantic Treaty Organisation)) "et al."((and others))',
	"m^2 H_2O `code` ''notexy'' \\*literal",
	'--dash --> arrow <-- and 8-) :-) :D',
	'&amp; &#160; &#x41; &unknown; &#0; &#1;',
	'<b class="x">bold</b> <img src=ok /> <!-- comment -->',
	':-)',
	'www.example.com https://ex.com/a?b=1 user@host.com',
	'a[[b]] [link](http://x) word:[target]',
	"lízně",
	"\u{a0}in text\u{a0}",
]);

// regex edge-case pairs: [pattern, subjects]
$extraPairs = [
	['~^ (--{3,}+|\*{3,}+) $~mUx', ['---', '----', '***', '**']],
	['~(?<=^|[\s([<:])(?: https?:// | www\. )~ix', ['see www.x', 'xhttps://', '(https://a', 'nbsp https://x']],
	['~\d{1,3}+~', ['abc 123 4567']],
	['~(a|ab)(c|bcd)(d*)~', ['abcd']],
	['~(?>ab|a)b~', ['ab', 'axb']], // atomic group: second must fail
	['~[^\s]*+~', ['ab cd']],
	['~\x{1EFF}+~u', ["\u{1EFF}\u{1EFF}"]],
	['~[A-Za-z\x{C0}-\x{2FF}\x{370}-\x{1EFF}]{2,}~u', ['Ahoj ěšč Mířenka Ĺ']],
	['~\[([^\]]++)\]~U', ['[abc][def]']],
	['~\((?: \d+ | (?: \( (?0) \) )\))*\)\z~x', ['(1(2(3)))', '(1(a))']], // recursion depth limit + \z
];

$corpus = ['subjects' => $subjects, 'patterns' => [], 'pairs' => []];

foreach (patternsOf('linePatterns', 'addLineSyntax') as $name => $pattern) {
	$corpus['patterns'][$name] = runPattern($pattern, $subjects);
}
foreach (patternsOf('blockPatterns', 'addBlockSyntax') as $name => $pattern) {
	$corpus['patterns'][$name] = runPattern($pattern, $subjects);
}

foreach ($extraPairs as [$pattern, $pairSubjects]) {
	$spec = runPattern($pattern, $pairSubjects);
	$spec['subjects'] = $pairSubjects;
	$corpus['pairs'][] = $spec;
}


function runPattern(string $pattern, array $subjects): array
{
	$entries = [];
	foreach ($subjects as $si => $subject) {
		$ms = Regexp::matchAll($subject, $pattern, captureOffset: true);
		$dump = [];
		foreach (array_slice($ms, 0, 40) as $m) {
			$captures = [];
			foreach ($m as $group) {
				$captures[] = [$group[0], $group[1]];
			}
			$dump[] = $captures;
		}
		if ($dump) {
			$entries[] = ['subjectIndex' => $si, 'matches' => $dump];
		}
	}
	return ['pattern' => $pattern, 'entries' => $entries];
}


echo json_encode($corpus, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
