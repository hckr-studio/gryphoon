<?php declare(strict_types=1);

// Differential probe: PHP TypographyModule::postLine vs @gryphoon/texy processTypo.
// Prints JSON cases; tools on the JS side replay them.

require __DIR__ . '/autoloader.php';

$texy = new Texy\Texy;
$mod = $texy->typographyModule;
$mod->locale = 'cs';

$inputs = [
	'Hello world...',
	'123-456',
	'al--pha',
	',- x',
	'23. 1. 1978',
	'23. 1.',
	'a --- b',
	'a - b',
	'x <-> y',
	'a --> b',
	'a <-- b',
	'a ==> b',
	'+- 5',
	'123 x 456',
	'123x456',
	'123x',
	'Značka (TM) a (R) a (C) a (EUR)',
	'1 123 123 123',
	'Kolem "prechodni uvozovky" a textu',
	"single 'quotes' here",
	'V textu je \x17 markup \x17 a obrázek \x16 vedle',
	'číslo 42 je málo',
	's v vodom',
	'Krát ké slovo',
	str_repeat('x', 55) . ' krát',
	'Toto je docela dlouhá věta, ve které zůstane sí',
	'unclosed "quote',
	'"a" "b"',
	'He said ""double"" inside',
	"a'b",
	'5 % sleva',
	'3 kg',
	'stránka 12,',
	'ul. Nová 5',
	"eme 'a' ile",
	'a... b',
	'. . .',
	'10 °C',
	'123 , x',
	'5 %',
	'5 €',
	'5 word',
	'3 (test)',
	'12 345',
	'cena 20 €',
	'je to 1+1',
	'TM',
	'(TM)',
	'x (tm)',
];

$out = [];
foreach ($inputs as $s) {
	$out[] = ['input' => $s, 'expected' => $mod->postLine($s)];
}

file_put_contents(__DIR__ . '/../tests/fixtures/typo-probe.json', json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
echo count($out), " cases\n";
