# texy-intellij

IntelliJ-platform plugin (WebStorm, IntelliJ IDEA, ...) with Texy! support:
the `.texy` file type, texy syntax highlighting, and **language injection**
into code blocks and the front matter. Part of the gryphoon monorepo
(`@gryphoon/texy-intellij`).

## What it does

- registers the `Texy` file type for `*.texy` with syntax highlighting:
  headings (`##`, `===`/`---` underlines), list bullets, quotes, HR lines,
  links (`"text":url`), images (`[*img*]`), references (`[ref]`), modifiers
  (`.(title)[class]{style}`), directives (`{{...}}`), HTML tags, entities,
  phrase marks (`**`, `*`, `//`, `` ` ``)
- injects the IDE language into code blocks via the platform's
  `MultiHostInjector` (the same mechanism as the built-in Markdown plugin):
  - `/-- code js ... \--` and `/-- pre js ... \--`
  - `/--php ... \--` (a lone language-shaped word)
  - `/-- html ... \--` (HTML fragments)
  - GFM fences: ` ```js ... ``` `
- injects the front matter (`---` at the document start): **yaml** by
  default, **EDN** when the section starts with `{:`
  (EDN resolves to the Clojure language when a Clojure plugin is installed,
  otherwise to the EDN TextMate grammar bundled with this plugin, so it
  colors in every IDE)
- structural blocks (`div`, `text`, `comment`, `texysource`) are not
  injected; a block language unknown to the IDE stays plain texy
- starts `@gryphoon/texy-lsp` (bundled in the plugin zip) through the
  platform's LSP integration: diagnostics, go-to-definition/references,
  document symbols, folding, completion, hover, inlay hints, quick
  fixes, rename and formatting. The script resolves from a workspace
  checkout (`packages/texy-lsp`) first, then from the bundled copy.
  Requires `node` on PATH or in the standard nvm/Homebrew locations.
  Syntax highlighting stays in the plugin's lexer; the server owns
  semantic analysis

## Build

```bash
yarn workspace @gryphoon/texy-intellij build
# or directly:
./gradlew buildPlugin
```

The artifact lands in `build/distributions/texy-intellij.zip`.

Requires the JBR bundled with the locally installed WebStorm on `JAVA_HOME`
(Gradle runs on it via the toolchain; the plugin compiles to bytecode 17,
`since-build 242`, no upper bound, verified compatible with WebStorm 2025.2
and 2026.3). The `org.jetbrains.intellij.platform` plugin (2.20.1) compiles
against the local WebStorm installation.

```bash
export JAVA_HOME=/Users/rarous/Applications/WebStorm.app/Contents/jbr/Contents/Home
```

## Install

```bash
# after building, in the IDE: Settings -> Plugins -> ⚙ -> Install Plugin from Disk...
open build/distributions/texy-intellij.zip
```

## Lexer smoke

```bash
./gradlew lexSmoke
```

Checks exact token tiling and the token classes of a representative
document (front matter, markers, inline syntaxes, blocks, fences).

## LSP handshake smoke

```bash
node lsp-handshake.mjs .intellijPlatform/sandbox/texy-intellij/WS-2026.3/plugins_runIde/texy-intellij/texy-lsp/bin/texy-lsp.js
```

Runs the full LSP lifecycle (initialize, didOpen, diagnostics push,
requests, shutdown, exit) against the bundled server copy.

## Verify compatibility

```bash
./gradlew verifyPlugin
```

(Checks WS-2026.3 and WS-2025.2; add versions in `build.gradle.kts`.)

## Notes

- blocks close at the first `\--` / closing fence; nested `/--` blocks are
  not tracked in v1
- injected-fragment edits write back through a custom `ElementManipulator`
