<?php declare(strict_types=1);

// Differential probe: Configurator::safeMode/disableLinks/disableImages
// applied to hostile inputs; the JS test replays the outputs.

require __DIR__ . '/autoloader.php';

$inputs = [
	// hostile HTML with dangerous schemes and tags
	'<a href="javascript:alert(1)">click</a> and <b onmouseover="alert(2)">bold</b>'
		. ' <script>alert(3)</script> <div class="c">div</div>',
	// modifier classes/styles/ids
	'Hello .[dangerous-class]{color:red}#evil-id!',
	// images and links
	'See [link](https://example.com) and image [* obr.jpg *]',
	// html comment and definition syntax
	'<!-- comment --> and [ref]: https://example.com then [ref]',
	// typography still on in safe mode
	'Quotes "test" and ellipsis...',
	'External http://link.example.cz too',
];

$modes = ['safe', 'disableLinks', 'disableImages', 'all'];

$cases = [];
foreach ($modes as $mode) {
	foreach ($inputs as $i => $input) {
		$texy = new Texy\Texy;
		if ($mode === 'safe' || $mode === 'all') {
			Texy\Configurator::safeMode($texy);
		}
		if ($mode === 'disableLinks' || $mode === 'all') {
			Texy\Configurator::disableLinks($texy);
		}
		if ($mode === 'disableImages' || $mode === 'all') {
			Texy\Configurator::disableImages($texy);
		}
		$cases[] = [
			'mode' => $mode,
			'input' => $input,
			'expected' => $texy->process($input),
		];
	}
}

file_put_contents(__DIR__ . '/../tests/fixtures/configurator-corpus.json', json_encode($cases, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
echo count($cases), " cases\n";
