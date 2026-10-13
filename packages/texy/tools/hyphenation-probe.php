<?php declare(strict_types=1);

// Differential probe: PHP HyphenationModule::postLine vs the JS port.
// Prints a JSON corpus; the JS test replays it.

require __DIR__ . '/autoloader.php';

$texy = new Texy\Texy;
$mod = $texy->hyphenationModule;

$words = [
	'nejneobhospodařovávatelnějšími',
	'nejkrásnější',
	'supercalifragilisticexpialidocious',
	'Pneumonoultramicroscopicsilicovolcanoconiosis',
	'electronmicroscopically',
	'abcdefghijklm',
	'aeiouaeiouaeiouaeiou',
	'prstysoudruhujeme',
	'sedmikráskamiluju',
	'Praha',
	'krá-slovo-dlouhé',
	'a-b-c-d-e-f-g-h-i-j-k-l',
	'chlebíček',
	'cholesterol',
	'soustruhařství',
	'zdeny',
	'AUTOmobilovými',
	'...dlouheslovo',
	'slovo.slovo.slovo.slo',
	'www.dlouhadomena.example.com',
	'samohláskasamohláska',
	'nejnevykrystalizovávatelnějšími',
	'vyšší',
	'lidumilován',
	'umělecký',
	'A0' . str_repeat('x', 25),
	str_repeat('a', 25),
	str_repeat('ab', 12),
	str_repeat('xx', 15) . '.cz',
	'nejneobhospodařovávatelnějšímiž',
	'visualbasicpowerprogramming',
	'paralelníprocesorizace',
	'staršíŽENSké',
	'řadový',
	"chlup\x15\x16\x17atý",
	"with\x17markup\x17inside",
	'konstantinoplskými',
	'mezera a dlouhé slovo tady',
];

$cases = [];
foreach ($words as $w) {
	$cases[] = ['input' => $w, 'expected' => $mod->postLine($w)];
}

// wordLimit variants
$mod->wordLimit = 10;
foreach (['nejneobhospodařovávatelnějšími', 'abcdefghij', 'abcdefghijk', 'supercalifragilistic'] as $w) {
	$cases[] = ['input' => $w, 'expected' => $mod->postLine($w), 'wordLimit' => 10];
}

file_put_contents(__DIR__ . '/../tests/fixtures/hyphenation-corpus.json', json_encode($cases, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
echo count($cases), " cases\n";
