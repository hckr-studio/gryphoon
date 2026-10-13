<?php declare(strict_types=1);

/**
 * Oracle for the Node.js port: runs the reference implementation's PARSE PHASE ONLY
 * (normalize + module pattern registration + engine block/inline parsing) and dumps
 * the resulting AST in the same format as tests/AstDumper.php.
 *
 * Transform passes, typography and rendering are deliberately NOT executed.
 *
 * Usage:
 *   php tools/php-oracle.php <source-file> [<more-files>...]     # prints one dump per file
 *   php tools/php-oracle.php --inline <source-file>              # parse as single line
 *   php tools/php-oracle.php --emoticon <source-file>            # with emoticon allowed
 *   php tools/php-oracle.php --generate                          # write dumps for all sources
 */

error_reporting(E_ALL & ~E_DEPRECATED);

require __DIR__ . '/autoloader.php';
require __DIR__ . '/../../../tests/AstDumper.php';

/** Parse-phase-only equivalent of Texy::parse(). */
function parseOnly(Texy\Texy $texy, string $input, bool $singleLine = false): Texy\Nodes\DocumentNode
{
	$text = Texy\Texy::normalize($input);

	foreach ($texy->getModules() as $module) {
		$module->beforeParse();
	}

	$context = $texy->createParseContext($texy->allowed);
	$content = $singleLine
		? $context->parseInline($text)
		: $context->parseBlock($text);

	return new Texy\Nodes\DocumentNode($content);
}


$flags = array_slice($argv, 1);
$args = array_values(array_filter($flags, fn($a) => !str_starts_with($a, '--')));
$generate = in_array('--generate', $flags, true);
$inline = in_array('--inline', $flags, true);
$emoticon = in_array('--emoticon', $flags, true);

if ($generate) {
	$sourcesDir = __DIR__ . '/../../../tests/Texy/sources';
	$outDir = __DIR__ . '/../tests/fixtures/parse';
	@mkdir($outDir, 0777, true);
	foreach (glob($sourcesDir . '/*.texy') as $file) {
		$texy = new Texy\Texy;
		$doc = parseOnly($texy, (string) file_get_contents($file));
		$name = basename($file, '.texy');
		file_put_contents("$outDir/$name.txt", AstDumper::dump($doc));
		echo "$name\n";
	}
	exit;
}

foreach ($args as $file) {
	$texy = new Texy\Texy;
	if ($emoticon) {
		$texy->allowed[Texy\Syntax::Emoticon] = true;
	}
	$doc = parseOnly($texy, (string) file_get_contents($file), $inline);
	echo AstDumper::dump($doc);
}
