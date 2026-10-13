<?php declare(strict_types=1);

/** Minimal autoloader for the Texy source tree, used by development tools only. */

require_once __DIR__ . '/../../../src/Texy/Nodes/enums.php';
require_once __DIR__ . '/../../../src/Texy/exceptions.php';

spl_autoload_register(function (string $class): void {
	$file = __DIR__ . '/../../../src/' . str_replace('\\', '/', $class) . '.php';
	if (is_file($file)) {
		require $file;
	}
});
