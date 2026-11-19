Gryphoon Texy! LSP
=================

Language server for the [Texy!](https://texy.nette.org) markup
language ([@gryphoon/texy](../texy)): JSON-RPC over stdio, built on
the parser's AST and lint pipeline - every position passes through the
same normalization bridge, so ranges land on the document as the
client sent it (CRLF and full-width character quirks included).

## Running

```js
// bin/texy-lsp.js - launch from any LSP client, e.g. VS Code's LanguageClient
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
const server = new LanguageClient(
  "texy",
  "Texy!",
  { command: process.execPath, args: ["node_modules/@gryphoon/texy-lsp/bin/texy-lsp.js"], transport: TransportKind.stdio },
);
server.start();
```

## WebStorm setup (LSP4IJ, no code)

JetBrains IDEs have no built-in "add language server" page; the
[LSP4IJ](https://github.com/redhat-developer/lsp4ij) plugin is the generic
LSP client for any of them:

1. Install the client plugin: Settings → Plugins → Marketplace →
   **LSP4IJ**, restart the IDE.
2. Register the file type: Settings → Editor → File Types → **+**,
   name `Texy`, pattern `*.texy`.
3. Add the server: Settings → Languages & Frameworks → Language Servers → **+**
   - Name: `texy`
   - Command:
     ```
     node /absolute/path/to/packages/texy-lsp/bin/texy-lsp.js
     ```
   - Mapping: file type `Texy`
   - Configuration → initializationOptions:
     ```json
     { "debounceMs": 150, "lineWidth": 80 }
     ```
4. Open a `.texy` file. Diagnostics publish on the first keypress
   (`debounceMs` delay); hover, completion, go-to-definition, rename,
   code actions and inlay hints follow per LSP4IJ's supported surface.

Sanity-check the server standalone before wiring it in - it must hang
silently waiting for JSON-RPC on stdin:

```bash
node packages/texy-lsp/bin/texy-lsp.js   # Ctrl-C to quit
```

## Capabilities

| Method | What it does |
|---|---|
| `publishDiagnostics` | parser lint (`html/tag-*`, `link|image/reference-undefined`, ...) plus reference health: `reference/unused` (a definition never used), `reference/duplicate` (a name defined twice - the last one wins) |
| `textDocument/definition` | `[ref]`/`[*ref*]` use -> its definition line; a definition line -> itself (go-to-declaration keeps the caret there) |
| `textDocument/references` | all use sites of the reference under the cursor (use token or definition line), declaration optional |
| `textDocument/documentHighlight` | the same tokens, `Read` for uses, `Write` for the definition |
| `textDocument/documentSymbol` | the heading outline (nested by level, sections run to the next same-or-higher heading) and the reference definitions as keys |
| `textDocument/foldingRange` | multi-line blocks: code/comment/div sections, blockquotes, soft-wrapped paragraphs, lists (also definition lists, items fold inside), tables; identical spans dedupe (a nested list's item vs its list, a single-paragraph quote vs its paragraph) |
| `textDocument/completion` | link targets: reference names by prefix inside `[…`/`[*…` brackets, and `#toc-…` heading anchors after the link-target separator (`"label":#`) |
| `textDocument/hover` | the target a `[ref]`/`[*ref*]` use or a definition resolves to |
| `textDocument/inlayHint` | the resolved target URL after every use token |
| `textDocument/documentLink` | autolinks, email, link/image targets, definition URLs - relative targets resolve against the document URI |
| `textDocument/codeAction` | quick fixes: insert the closing tag (at its block's end), delete a stray closing tag, escape a rejected tag to the text it renders as anyway, append a definition stub for an undefined reference |
| `textDocument/selectionRange` | the AST node chain around the position, innermost first, whole document last |
| `textDocument/prepareRename` + `rename` | reference rename: every use + every definition, each site keeps its `[ref]`/`[*ref*]` written form |
| `textDocument/formatting` | per-block source formatting: paragraphs (also in quotes/single-block list items) rewrap at `lineWidth`, headings normalize to the written `#` form; verbatim blocks (code, tables, definitions, ...) are never touched, and neither is a leading YAML front matter (`---` … `---`) |
| `textDocument/rangeFormatting` | the same, restricted to the blocks overlapping the range |

Editor-friendly conventions: syntaxes highlight through
`documentHighlight` (uses) and diagnostics keep the parser's stable
issue codes, so filtering/severities can be configured by code.

## Configuration

`initializationOptions` on `initialize` (and `workspace/didChangeConfiguration`
with `settings.texy`, either shape):

```js
{ texy: { debounceMs: 150, lineWidth: 80, headingStyle: "preserve" } }
```

- `debounceMs` - the didChange analysis delay
- `lineWidth` - the formatting wrap width
- `headingStyle` - how formatting rewrites headings: `preserve` (default,
  each heading keeps the notation it was written in; the underlined form
  stays verbatim, the written form loses only its closing marker run),
  `inline` (convert to the written form, e.g. `Title\n=====` -> `##### Title`,
  the level kept so it reparses the same), or `multiline` (convert to the
  underlined form; a level with no underline character - 5 and 6 under the
  default `# * = -` map - keeps the written form)

The same styles are readable from the `TEXY_LSP_HEADING_STYLE` environment
variable at spawn time (used by the IntelliJ extension).

## Tests

```bash
npm test          # node --test tests/ - protocol tests over real stdio
```
