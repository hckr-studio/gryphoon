<?php declare(strict_types=1);

/**
 * Oracle for wordwrap(): generates a differential corpus of inputs and PHP
 * results as JSON, consumed by tests/wordwrap.test.js.
 *
 * PHP wordwrap counts bytes and breaks at the last break character of an
 * over-long line, consuming it. The corpus pins these semantics down so the
 * JS port can be validated case by case.
 */

$inputs = [];

// hand-written edge cases
$inputs = array_merge($inputs, [
	'', ' ', '  ', 'a', 'ab', ' ', 'aaa bbb ccc ddd', 'aa   bb cc', 'aaaaaa bb',
	'aaaaa bbb', 'aa  bb', 'aaaaa ', 'aaa bb cc', '  aa bb', 'a á bbbb c',
	'ááá áááá áá', 'áá áááá á', 'ab  cde', 'aaa bbb', 'ab cde', 'ab  cde',
	'x', 'hello world', 'hello  world', 'hello world  ', ' hello world',
	'The quick brown fox jumped over the lazy dog.',
	'Příliš žluťoučký kůň pádělšššš úděly málo a čím dál míň',
	"tab\tseparated\ttext with words and more words here to wrap",
	"a\nb", "\n\n", "a\n", "\na", "aaaaaaaaaaaaaaa b",
	'word', 'word word', 'one two three four five six seven eight',
]);

// systematic battery: words of varying lengths and gaps, incl. multibyte
$words = ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'áá', 'ůůůů', 'ž', 'x'];
$gaps = [' ', '  ', '   '];
for ($i = 0; $i < 9; $i++) {
	for ($j = 0; $j < 9; $j++) {
		if ($i === $j) continue;
		$s = $words[$i] . $gaps[$j % 3] . $words[($i + $j) % 9];
		if ($j % 4 === 0) $s .= ' ' . $words[($i + $j + 3) % 9];
		if ($j % 5 === 0) $s = ' ' . $s;
		$inputs[] = $s;
	}
}

// pseudo-random strings (deterministic seed)
mt_srand(42);
$alphabet = ['a', 'b', 'c', 'á', 'ž', ' ', ' ', ' ', 'č', 'dd'];
for ($n = 0; $n < 60; $n++) {
	$len = 5 + mt_rand(0, 40);
	$s = '';
	for ($k = 0; $k < $len; $k++) {
		$s .= $alphabet[mt_rand(0, 9)];
	}
	$inputs[] = $s;
}

$breaks = ["\n", '|', "\n\t\t", '::'];
$widths = [1, 2, 3, 4, 5, 8, 13];

$cases = [];
foreach ($inputs as $s) {
	foreach ($widths as $w) {
		foreach ($breaks as $brk) {
			if ($brk === '::' && ($w > 5 || strlen($s) > 60)) continue; // keep the corpus small
			$cases[] = [
				'input' => $s,
				'width' => $w,
				'break' => $brk,
				'expected' => wordwrap($s, $w, $brk),
			];
		}
	}
}

file_put_contents(__DIR__ . '/../tests/fixtures/wordwrap-corpus.json', json_encode($cases, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
echo count($cases), " cases\n";
