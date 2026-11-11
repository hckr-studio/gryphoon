Gryphoon Texy!
=============

A Node.js port of [Texy](https://texy.nette.org).
This implementation covers the full pipeline:

```
normalize -> parse (BlockParser + InlineParser -> AST)
          -> transform passes (directives, HTML pairing + sanitizing,
             reference resolution, emoticons, heading balancing,
             typography, hyphenation)
          -> render (Element/Raw render tree -> WellFormer -> HTML,
             or plain text, or a linkedom DOM)
```

**Typography** (`src/Typography.js`, `processTypo` - the reference
pattern catalog over the TextRunPass marker alphabet) and
**hyphenation** (`longwords`) are ports. Both are applied as text-run
passes over the AST the same way the reference does (see
`src/Passes/TextRunPass.js`).

## Usage

```js
import { Texy } from './src/Texy.js';
import { Configurator } from './src/Configurator.js';

const texy = new Texy();
const html = texy.process('Hello **world**!');        // text -> HTML string
const plain = texy.toText('Hello **world**!');        // text -> plain-text rendition

const document = texy.parse('Hello **world**!');     // -> DocumentNode
// ... inspect or transform the AST ...
const html2 = texy.renderHtml(document);             // AST -> HTML string
const plain2 = texy.renderText(document);             // AST -> plain text

// for untrusted input (web comments etc.):
const unsafe = new Texy();
Configurator.safeMode(unsafe);
```

### Declarative configuration (defTexy)

`defTexy(config)` builds a fully configured instance from one plain
object (exported from the package root together with `Syntax`,
`Configuration` and `Configurator`):

```js
import { Configuration, defTexy, Syntax } from '@gryphoon/texy';

const texy = defTexy({
  ...Configuration.safe,                // untrusted input (web comments etc.)
  allowed: [Syntax.Inserted, Syntax.Deleted, Syntax.Subscript, Syntax.Superscript],
  htmlPolicy: { allowedTags: false },   // key-level override on top of the preset
  headingModule: { top: 4 },
});
```

- `...Configuration.safe` - a spreadable preset that applies
  `Configurator.safeMode` as the base configuration; the remaining keys
  override it **by name** (the preset is carried by a symbol that
  survives object spread). Spreading a preset and overriding sections
  keeps everything the preset set elsewhere: in the example above,
  `allowedClasses`/`allowedStyles` stay `None` and safe mode's syntax
  disables survive - `allowed` only adds the four phrase syntaxes.
- `allowed` - an array of `Syntax` names to enable, or a
  `{ 'phrase/ins': true, typography: false, ... }` map (the same
  switches as `texy.allowed`).
- `htmlPolicy`, `urlPolicy`, `htmlOutput` - section objects assigning
  the matching instance properties (allowedTags, linkPattern, indent, ...).
- module sections keyed by the module handle - `headingModule`,
  `paragraphModule`, `phraseModule`, `linkModule`, `listModule`,
  `emoticonModule`, `imageModule`, `directiveModule`, `typographyModule`,
  `hyphenationModule` - assign onto the module. Unknown section names
  throw.

### DOM-based transform and serialization (linkedom)

`renderDom()` projects the rendered tree onto a [linkedom](https://github.com/WebReflection/linkedom)
`Document` (content in its `<body>`) for DOM-side transformation; serialize
afterwards with linkedom itself:

```js
const dom = texy.renderDom(document);
dom.body.querySelectorAll('a[href^="http"]').forEach(a => a.setAttribute('target', '_blank'));
console.log(dom.body.innerHTML);
```

`process()` does **not** go through linkedom: it serializes the PHP-faithful
render tree with the ported `WellFormer` (pairing fixes, content model,
indentation, line wrapping), which is what makes the output byte-identical
with the reference. The DOM projection is the transform/serialization phase
in DOM form, for consumers that need a real DOM.

Differences inherent to the DOM projection: `Raw` fragments are parsed into
real nodes (their HTML is trusted - it passed the render pipeline), boolean
attributes serialize as `name=""`, void elements never receive children,
and no well-forming is re-applied after DOM mutation.

- `texy.allowed` - syntax switches (`{ 'phrase/ins': true, emoticon: true, ... }`),
  same names as the reference `Texy\Syntax` constants (see `src/Syntax.js`).
  Typography (`allowed['typography']`) and hyphenation
  (`allowed['longwords']`) are on by default, like in the reference.
- `texy.typographyModule.locale` - locale for typographic quotation marks
  (`'cs'` default, like the reference module); passed through to
  `processTypo`.
- `texy.hyphenationModule.wordLimit` - words longer than this many
  characters get soft-hyphen hints (20 by default, like the reference).
- `Configurator.safeMode(texy)` / `disableLinks(texy)` / `disableImages(texy)`
  - basic configuration presets (port of `Texy\Configurator`); run
  `safeMode` for untrusted input.
- `texy.htmlOutput` - the HTML output configuration (port of
  `Texy\Output\Html\Config`): `indent`, `lineWrap`, `baseIndent`,
  `preserveSpaces`, `textAlignClasses`, `verticalAlignClasses`,
  `floatClasses`, `phraseTags`, `imageBaseUrl`, `imageBasePath`,
  `linkBaseUrl`, `obfuscateEmail`, `imageParagraphTag`, `figureTag`,
  `figureClass`, `emoticonClass`, `linkNoFollow`, `passHtmlComments`, ...
- `texy.htmlPolicy` - HTML security policy (allowed tags/classes/styles),
  `texy.urlPolicy` - URL scheme policy; both enforced in the transform
  passes (protecting every output format) and again at render time.
- `texy.htmlOutput.addRenderer(NodeClass, handler)` - custom node renderers;
  `handler(node, renderer, previous)` returns a new result or null to chain
  to the previous renderer. (The reference reads the node class from the
  first parameter's type hint; JavaScript has none, so it is passed
  explicitly.)
- `texy.addPass(pass)` - custom transform passes, `fn(DocumentNode): void`.
  Typography runs after them (as in the reference); a document can be
  re-typographed manually via `texy.applyAstTypography(document)`, and
  `texy.applyTypography(text)` typographies a plain string.
- `texy.paragraphModule.mergeLines`, `texy.listModule.bullets`,
  `texy.headingModule.*`, `texy.emoticonModule.icons`, ... - the same
  parse-relevant configuration surface the reference modules expose.
- `texy.addInlineSyntax(name, pattern, handler)` / `texy.addBlockSyntax(...)` -
  extension syntaxes; consumer registrations are never overwritten by
  module pattern refreshes (same precedence rules as the reference).
- `texy.createHtmlRenderer()` - a `Renderer` wired to the current
  configuration; needs no live Texy instance and is reusable across
  documents (`renderer.render(document)`, `renderer.renderToDom(document)`).

Ranges (`node.range`) are `{ offset, length }` in **UTF-16 code units** of
the normalized source (see Deviations).

### Texy 3 link references (historical documents)

The 4-dev reference deprecates and IGNORES the label and modifier of a
`[ref]: url label .(title)[class]{style}` definition. For historical
documents this port restores the Texy 3 semantics, opt-in:

```js
const texy = new Texy();
texy.linkModule.legacyReferences = true;  // the Texy 3 reference semantics
                                         // (implies the bare [ref] syntax;
                                         // allowed['link/reference'] opts
                                         // in just the syntax otherwise)
```

- the definition's **label** becomes the content of a bare `[ref]` use,
  inline-parsed (references inside resolve recursively, circular labels
  render raw - the Texy 3 livelock); without a label the shortened URL
  shows (the Texy 3 `textualUrl`)
- the definition's **modifier** applies to every use site, the use-site
  modifier on top (title/id/alignments overwrite, classes/styles/
  attributes union - the Texy 3 `Modifier::setProperties` semantics)
- a `%s` in a reference URL takes the use-site text, form-url-encoded
  `urlencode` except `*` - a valid
  URL sub-delim, it stays literal); bare `[ref]` keeps the `%s` literal
- an image definition's modifier applies to `[*img*]` link targets
- `linkModule.addDefinition(name, url, label?, modifier?)` carries the
  Texy 3 `Link::$label` / `Link::$modifier` (the modifier as written,
  with or without the leading dot)

Expected outputs verified against the actual Texy 3.2.8 (extracted from
this repo's git tags) - see `tests/references.test.js`.

## Tests

```bash
npm test          # node --test tests/
```

The suite is based on the PHP test suite and the repository fixtures
(all fixture sets live in the sibling `texy-fixtures` package, generated by
the oracle tools of the texy reference repository):

- `tests/conformance.test.js` - every `texy-fixtures/sources/*.texy` (shared) fixture is
  parsed and its AST dump must match the reference implementation's
  parse-phase AST, byte for byte. Expected dumps live in
  `texy-fixtures/parse/`, generated by `tools/php-oracle.php` (needs PHP).
- `tests/passed.test.js` - the same matrix after the transform passes
  (`texy-fixtures/passed/`, generated by `tools/transform-oracle.php
  --passed`).
- `tests/render.test.js` - the same matrix through `process()` with
  typography disabled: the output HTML must be byte-identical
  (`texy-fixtures/render/`, generated by `tools/transform-oracle.php
  --render --emoticon`; hyphenation disabled on the reference side).
- `tests/render-typo.test.js` - the same matrix with typography enabled
  (`texy-fixtures/render-typo/`, generated by
  `tools/transform-oracle.php --render-typo --emoticon`); sources with
  documented divergences are skipped with justification.
- `tests/render-full.test.js` - the same matrix with the full default
  configuration, typography + hyphenation
  (`texy-fixtures/render-full/`, generated by
  `tools/transform-oracle.php --render-full --emoticon`).
- `tests/text.test.js` - the plain-text rendition (`toText()`) matrix
  (`texy-fixtures/text/`, generated by
  `tools/transform-oracle.php --text --emoticon`).
- `tests/hyphenation.test.js` - a hyphenation probe corpus (generated by
  `tools/hyphenation-probe.php`: long Czech words, marker bytes, wordLimit
  variants) plus pipeline integration.
- `tests/configurator.test.js` - safeMode/disableLinks/disableImages
  replayed over hostile inputs (generated by
  `tools/configurator-probe.php`) plus the policy values they set.
- `tests/image-dimensions.test.js` - image header parsing (PNG, GIF,
  JPEG, BMP, WebP) and the dimension-scaling arithmetic.
- `tests/typography.test.js` - the typography integration: a probe corpus
  of `TypographyModule::postLine` vs `processTypo` (generated by
  `tools/typo-probe.php`), the pre-processing, locale config, and the
  TextRunPass pipeline behavior (code protection, titles, disabled state,
  renderer fallback).
- `tests/regexp.test.js` - a differential corpus: all real parse-phase
  patterns of the reference engine, replayed over the fixture sources plus
  feature snippets, asserting matches identical to PCRE. Generated by
  `tools/regexp-corpus.php`.
- `tests/wordwrap.test.js` - a 4300+-case PHP `wordwrap()` differential
  corpus (byte counting, break placement), generated by
  `tools/wordwrap-oracle.php`.
- `tests/wellformer.test.js` - WellFormer mechanics (indentation, optional
  end tags, content model, voids, raw tokenization, back-tab, wrapping) over
  hand-built trees; goldens generated by `tools/wellformer-probe.php`.
- `tests/html-output.test.js` - render-tree primitives: `Element` attribute
  formatting and the `ElementDecorator` policy behavior.
- `tests/dom.test.js` - the linkedom DOM projection.
- `tests/parsing.test.js`, `tests/range.test.js`, `tests/normalize.test.js`,
  `tests/modifier.test.js`, `tests/helpers.test.js` - ports of the
  corresponding `.phpt` unit tests (`InlineParser`, `BlockParser`, `range`,
  `normalize`, modifier/entity semantics probed against PHP).
- `tests/syntax.test.js` - syntax-level assertions ported from the
  subject-specific `.phpt` files, mapped to AST-level expectations.
- `tests/helpers/diff-fixture.mjs <fixture-name>` - debugging helper printing
  the first differences against an oracle fixture.

## Layout

```
src/
  Texy.js            facade: modules, allowed map, parse(), process(),
                     toText(), renderHtml(), renderText(), renderDom(),
                     createHtmlRenderer()
  Configurator.js    safeMode/disableLinks/disableImages presets
  normalize.js       canonical form of the input
  Regexp.js          PCRE->JS RegExp translation layer (see below)
  Patterns.js        shared grammar patterns, kept in PCRE syntax
  Syntax.js          syntax name constants
  Range.js           {offset, length} ranges + Node base class
  Modifier.js        .(title)[class]{style}<^ parsing
  UrlPolicy.js       link/image scheme policy (parse time + render time)
  HtmlPolicy.js      tag/class/style whitelist (transform pass + render)
  NodeHelpers.js     find/findFirst/extractText/cloneNode
  NodeTraverser.js   enter/leave traversal for transform passes
  helpers.js         entity decoding (PHP html_entity_decode semantics),
                     URL helpers, PHP-faithful trims
  wordwrap.js        PHP wordwrap() (bytes, break placement) for WellFormer
  nodes.js           the AST node classes (DocumentNode ... LinkDefinitionNode)
  entities.json      2125 HTML5 named entities, verified against PHP
  Parsing/           Engine, InlineParser, BlockParser, ParseContext, OffsetMap
  Modules/           the syntax modules + TypographyModule (processTypo
                     wrapper) + HyphenationModule (longwords)
  Passes/            HtmlPairingPass, HtmlSanitizePass, HeadingPass, TextRunPass
  Output/
    NodeRenderer.js  class-dispatch render handler base
    Html/
      Schema.js      HTML vocabulary: content model, voids, prohibitions
      Config.js      htmlOutput configuration
      Element.js     render-tree element (attrs, children, formatAttrs)
      Raw.js         pre-serialized HTML fragment
      ElementDecorator.js  modifier -> element (the policy chokepoint)
      ImageDimensions.js   file-system image dimension detection
      Renderer.js    per-node render handlers
      WellFormer.js  well-forming + formatting serializer
      DomBuilder.js  linkedom DOM projection
    Text/
      Renderer.js    plain-text rendition (toText)
tests/               the test suite (fixtures live in the shared ../texy-fixtures
                     package, generated by the oracle tools of the texy
                     reference repository)
```

## The regex translation layer

The reference grammar is defined by PCRE patterns (porting.md: "the
reference regexes are the authoritative grammar"), so the port keeps the
patterns in PCRE syntax and translates them to native `RegExp` at compile
time (`src/Regexp.js`):

- `x` extended mode (incl. inline `(?x:...)` groups) - whitespace/comments stripped;
- `U` ungreedy mode - quantifier greediness swapped;
- possessive quantifiers and atomic groups - emulated with
  `(?=(?<pN>atom))\k<pN>` (assertions are not re-entered while backtracking);
- `\s` - PCRE's UTF-8 set (probed against the reference: Unicode spaces but
  not the BOM; JS `\s` differs);
- pattern recursion `(?0)` - expanded inline to a bounded depth;
- PCRE's `]`-first-char-in-class and `\x{...}` rules;
- `\A`, `\z`, `\Z` anchors, ungreedy-swap interactions.

Group numbering is preserved via named groups (`(?<c1>...)`), so emulation
groups never shift the capture indices handlers rely on. The differential
corpus test replays every real pattern against PCRE results.

## Deviations from the reference (deliberate)

1. **Offsets are UTF-16 code units, not bytes.** JS strings are UTF-16; the
   engine counts code units consistently (slicing by `range` always yields
   the source span). The test dumper converts to UTF-8 byte offsets when
   comparing against the PHP-generated fixtures, so byte-exactness is still
   verified. Quantifier limits (`{1,1000}` etc.) count code units, so
   non-ASCII URLs/images can be twice as long as in PHP - a bound, not a
   semantic difference. The **renderer** counts bytes where it matters for
   output: `wordwrap()` measures line length in UTF-8 bytes exactly like
   PHP.
2. **Lone surrogates replace the invalid-UTF-8 check** in `normalize()` - a
   JS string can only be invalid UTF-8 through an unpaired surrogate.
3. **Pattern recursion depth** for the `/--.../--` block grammar is expanded
   to a fixed depth (8) instead of PCRE's unbounded `(?0)`; nesting fences
   deeper than that degrade gracefully (the innermost block falls back to
   plain content lines).
4. **Ranges are plain `{offset, length}` objects** (`Range` is exported as a
   convenience constructor); the tree is duck-typed.
5. **Typography** (`src/Typography.js`, `processTypo`) is wired in
   exactly at the reference's seams: the TextRunPass over the AST and the
   renderer's postLine for isolated strings (titles, alt texts). The
   pattern catalog matches the reference postLine on the replay corpus
   in `texy-fixtures/typo-probe.json` (49 reference-generated cases,
   including the nbsp-class boundaries like "10 °C"; CJK and other
   scripts deliberately get the nbsp too - the reference's legacy
   Letter ranges stop at U+1EFF, \p{Letter} covers all scripts);
   the locale catalog covers the reference's languages plus
   sk/nl/da/hr/fi. Hyphenation is a straight port (validated
   byte-for-byte by `tests/hyphenation.test.js` and the `render-full`
   fixtures).
6. **Image dimension detection parses PNG, GIF, JPEG, BMP and WebP
   headers** (`Output/Html/ImageDimensions.js`) where the reference relies
   on PHP's `getimagesize()`; other formats fall back to the AST's
   dimensions, like a missing file does.
7. **`htmlOutput.addRenderer(NodeClass, handler)`** takes the node class
   explicitly - JavaScript has no runtime parameter types to read it from.
8. **`renderDom()`** (linkedom projection) is an extension of the reference
   API; `process()` output stays byte-identical with the reference.

# Publish to npm

```bash
yarn npm login
yarn npm publish --access public --tag latest
```
