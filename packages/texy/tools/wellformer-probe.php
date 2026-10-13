<?php declare(strict_types=1);

// Throwaway probe: golden outputs for tests/wellformer.test.js.

require __DIR__ . '/autoloader.php';

use Texy\Output\Html\{Config, Element, Raw, WellFormer};

function render($child, $cfg = null): string {
	$cfg = $cfg ?? new Config;
	$wf = new WellFormer($cfg);
	$wf->feed($child);
	return $wf->finish();
}

$p = new Element('p'); $p->setText('Hello');
echo "1:", json_encode(render($p)), "\n";

$p = new Element('p'); $p->setText("a  b \n\n c");
echo "2:", json_encode(render($p)), "\n";

$p = new Element('p'); $p->add('a ')->add(new Element('strong'))->add('b');
echo "3:", json_encode(render($p)), "\n";

$d = new Element('div'); $d->create('p')->setText('one'); $d->create('p')->setText('two');
echo "4:", json_encode(render($d)), "\n";

$d = new Element('div'); $x = $d->create('my-widget'); $x->create('p')->setText('in');
echo "5:", json_encode(render($d)), "\n";

$p = new Element('p'); $p->add(new Raw('a < b &amp; <br> <!-- c --> tail'));
echo "6:", json_encode(render($p)), "\n";

$d = new Element('div'); $d->create('hr'); $d->create('p')->setText('x');
echo "7:", json_encode(render($d)), "\n";

$t = new Element('table'); $t->add('stray'); $t->create('tr')->create('td')->setText('cell');
echo "8:", json_encode(render($t)), "\n";

$outer = new Element('a', ['href' => 'x']); $outer->add('in')->add(new Element('a', ['href' => 'y']))->add('after');
echo "9:", json_encode(render($outer)), "\n";

$pre = new Element('pre'); $pre->create('code')->setText('  a   b  ');
echo "10:", json_encode(render($pre)), "\n";

$p = new Element('p'); $p->add(new Raw('a</br>b<img src="x"><hr>c'));
echo "11:", json_encode(render($p)), "\n";

$cfg = new Config; $cfg->lineWrap = 10;
$p = new Element('p'); $p->setText('aaa bbb ccc ddd eee fff ggg');
echo "12:", json_encode(render($p, $cfg)), "\n";

$cfg = new Config; $cfg->indent = false;
$d = new Element('div'); $d->create('p')->setText('x');
echo "13:", json_encode(render($d, $cfg)), "\n";

$p = new Element('p'); $p->add('a')->add(new Element('br'))->add('  b');
echo "14:", json_encode(render($p)), "\n";

$cfg = new Config; $cfg->baseIndent = 2;
$d = new Element('div'); $d->create('p')->setText('x');
echo "15:", json_encode(render($d, $cfg)), "\n";

// strong auto-reopen across em (inline autoclose + autoopen)
$p = new Element('p');
$p->add(new Element('strong'))->add(new Element('em'))->add('x')->add(new Raw('</strong>'));
echo "16:", json_encode(render($p)), "\n";

// disallowed tag inside p (script in p is phrasing, use iframe-empty? no) - block tag inside p closes it
$d = new Element('div'); $d->create('p')->setText('a'); $d->create('blockquote')->setText('q');
echo "17:", json_encode(render($d)), "\n";
