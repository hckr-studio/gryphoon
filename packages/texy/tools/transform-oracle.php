<?php declare(strict_types=1);

/**
 * Oracle for the Node.js port - transform and render phases.
 *
 * Modes:
 *   --passed      dump the AST after the transform passes (directives, HTML
 *                 pairing + sanitizing, reference resolution, emoticons, heading
 *                 pass; typography deliberately skipped) for all sources
 *   --render      dump process() output (transform + rendering, typography and
 *                 hyphenation disabled)
 *   --render-typo dump process() output with typography ENABLED (the port
 *                 delegates it to the @gryphoon/texy library); hyphenation
 *                 still disabled
 *   --render-full dump process() output with the full default configuration
 *                 (typography + hyphenation on)
 *   --render-flat dump process() output with typography, hyphenation AND the
 *                 well-former formatting disabled (indent off, lineWrap 0) -
 *                 the comparison target for renderers producing flat markup
 *                 (e.g. the Clojure/hiccup port)
 *   --text        dump toText() output (plain-text rendition), full default
 *                 configuration
 *
 * Fixture sources: tests/Texy/sources/*.texy, default configuration.
 */

error_reporting(E_ALL & ~E_DEPRECATED);

require __DIR__ . '/autoloader.php';
require __DIR__ . '/../../../tests/AstDumper.php';

/** Runs the parse phase plus all non-typography transform passes. */
function parseWithPasses(Texy\Texy $texy, string $input): Texy\Nodes\DocumentNode
{
	$doc = parseOnly($texy, $input);

	foreach ($texy->getModules() as $module) {
		// the pass pipeline of Texy::parse(), in module order, minus typography
		if ($module instanceof Texy\Modules\DirectiveModule) {
			$module->processDirectives($doc);
		} elseif ($module instanceof Texy\Modules\HtmlModule) {
			$module->processPassthrough($doc);
		} elseif ($module instanceof Texy\Modules\ImageModule) {
			$module->resolveReferences($doc);
		} elseif ($module instanceof Texy\Modules\LinkReferenceModule) {
			$module->resolveReferences($doc);
		} elseif ($module instanceof Texy\Modules\EmoticonModule) {
			$module->resolveEmoticons($doc);
		} elseif ($module instanceof Texy\Modules\HeadingModule) {
			$pass = new ReflectionMethod($module, 'afterParse');
			$pass->setAccessible(true);
			$pass->invoke($module, $doc);
		}
	}

	return $doc;
}


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


$mode = $argv[1] ?? '';
$emoticon = in_array('--emoticon', $argv, true);

$sourcesDir = __DIR__ . '/../../../tests/Texy/sources';

if ($mode === '--passed') {
	$outDir = __DIR__ . '/../tests/fixtures/passed';
	@mkdir($outDir, 0777, true);
	foreach (glob($sourcesDir . '/*.texy') as $file) {
		$texy = new Texy\Texy;
		if ($emoticon) {
			$texy->allowed[Texy\Syntax::Emoticon] = true;
		}
		$doc = parseWithPasses($texy, (string) file_get_contents($file));
		file_put_contents($outDir . '/' . basename($file, '.texy') . '.txt', AstDumper::dump($doc));
		echo basename($file), "\n";
	}
	exit;
}

if ($mode === '--render') {
	$outDir = __DIR__ . '/../tests/fixtures/render';
	@mkdir($outDir, 0777, true);
	foreach (glob($sourcesDir . '/*.texy') as $file) {
		$texy = new Texy\Texy;
		$texy->allowed[Texy\Syntax::Typography] = false; // not implemented in the port
		$texy->allowed[Texy\Syntax::Hyphenation] = false;
		if ($emoticon) {
			$texy->allowed[Texy\Syntax::Emoticon] = true;
		}
		$html = $texy->process((string) file_get_contents($file));
		file_put_contents($outDir . '/' . basename($file, '.texy') . '.html', $html);
		echo basename($file), "\n";
	}
	exit;
}

if ($mode === '--render-typo') {
	$outDir = __DIR__ . '/../tests/fixtures/render-typo';
	@mkdir($outDir, 0777, true);
	foreach (glob($sourcesDir . '/*.texy') as $file) {
		$texy = new Texy\Texy;
		// typography stays enabled (the port delegates it to @gryphoon/texy);
		// hyphenation is not implemented in the port
		$texy->allowed[Texy\Syntax::Hyphenation] = false;
		if ($emoticon) {
			$texy->allowed[Texy\Syntax::Emoticon] = true;
		}
		$html = $texy->process((string) file_get_contents($file));
		file_put_contents($outDir . '/' . basename($file, '.texy') . '.html', $html);
		echo basename($file), "\n";
	}
	exit;
}

if ($mode === '--render-typo-flat') {
	// written on the Clojure port's fixtures: typography on (that port's
	// default), hyphenation off, and the flat formatting that port renders
	$outDir = __DIR__ . '/../../clojure/fixtures/render-typo';
	@mkdir($outDir, 0777, true);
	foreach (glob($sourcesDir . '/*.texy') as $file) {
		$texy = new Texy\Texy;
		$texy->allowed[Texy\Syntax::Hyphenation] = false;
		$texy->htmlOutput->indent = false;
		$texy->htmlOutput->lineWrap = 0;
		$html = $texy->process((string) file_get_contents($file));
		file_put_contents($outDir . '/' . basename($file, '.texy') . '.html', $html);
		echo basename($file), "\n";
	}
	exit;
}

if ($mode === '--render-flat') {
	// written to the Clojure port's fixtures: that port renders flat markup
	// and compares against this output; emoticons stay off (its default)
	$outDir = __DIR__ . '/../../clojure/fixtures/render-flat';
	@mkdir($outDir, 0777, true);
	foreach (glob($sourcesDir . '/*.texy') as $file) {
		$texy = new Texy\Texy;
		$texy->allowed[Texy\Syntax::Typography] = false;
		$texy->allowed[Texy\Syntax::Hyphenation] = false;
		$texy->htmlOutput->indent = false;
		$texy->htmlOutput->lineWrap = 0;
		$html = $texy->process((string) file_get_contents($file));
		file_put_contents($outDir . '/' . basename($file, '.texy') . '.html', $html);
		echo basename($file), "\n";
	}
	exit;
}

if ($mode === '--render-full' || $mode === '--text') {
	$outDir = __DIR__ . '/../tests/fixtures/' . ($mode === '--text' ? 'text' : 'render-full');
	@mkdir($outDir, 0777, true);
	foreach (glob($sourcesDir . '/*.texy') as $file) {
		$texy = new Texy\Texy; // full default configuration: typography + hyphenation on
		if ($emoticon) {
			$texy->allowed[Texy\Syntax::Emoticon] = true;
		}
		$content = $mode === '--text'
			? $texy->toText((string) file_get_contents($file))
			: $texy->process((string) file_get_contents($file));
		file_put_contents($outDir . '/' . basename($file, '.texy') . ($mode === '--text' ? '.txt' : '.html'), $content);
		echo basename($file), "\n";
	}
	exit;
}

exit("Usage: php transform-oracle.php --passed|--render|--render-typo|--render-flat|--render-full|--text [--emoticon]\n");
