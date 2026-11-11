# Texy for Clojure

A Clojure port of [Texy](https://texy.nette.org), driven by
docs/porting.md of the reference implementation (the Texy PHP repository) as the requirements document.
It covers a well-defined subset of the pipeline:

```
normalize -> parse (block + inline engine -> AST of plain maps)
           -> transform passes (directives, HTML pairing + sanitization,
              link/image reference resolution, heading level balancing,
              typography, hyphenation)
           -> render (AST -> hiccup vectors -> jsoup well-forming
              -> WellFormer formatting -> serialization)
```

Typography, hyphenation AND the output formatting (block indentation
with tabs, line wrapping at 80 - the reference WellFormer defaults)
are on by default; :hyphenation / :word-limit / :indent false /
:line-wrap 0 configure them. The global well-forming phase has
two implementations: jsoup's HTML5 tree construction (`work.gryphoon.texy.dom`, the
default - spec-conformant repair of hostile input) and the call-driven
WellFormer driver ported from the Node.js sibling
(`work.gryphoon.texy.wellformer` serialize-direct, opt-in via `:well-forming :direct`
on the converter or per call - no serialize->parse->convert round-trip,
no implicit <tbody> in passthrough tables, bare boolean attributes
like the reference, ~5% faster); 28 of
the 31 original test sources pass conformance - in all three fixture
sets, typography off, typography on, and the full formatted set - the
three gaps are documented in
`known-gaps` in `test/work/gryphoon/texy/conformance_test.clj`.

## Usage

```clojure
(require '[work.gryphoon.texy.core :as texy])

(texy/process (texy/->texy) "Hello **world**!")   ; => HTML string

(def doc (texy/parse (texy/->texy) "Hello **world**!"))  ; => AST map
(texy/render-html doc)                            ; AST -> HTML string
(texy/render-hiccup doc)                          ; AST -> hiccup vectors
(texy/render-text doc)                            ; AST -> plain text
```

`(texy/to-text (texy/->texy) "...")` is the one-call form. With
`:single-line true` the text parses as one inline line, like the
reference's `process($text, singleLine: true)`.

Converter options: `:merge-lines` (default true), `:top`,
`:fixed-leveling`, `:generate-ids` / `:id-prefix` (heading ids for a
`{toc:}`), `:image-root` (default none, URLs are used as written),
`:link-root`, `:link-no-follow`, `:link-pattern` / `:image-pattern`
(URL scheme policy - a disallowed link drops to its content, a
disallowed image renders as its alternative text), `:well-forming`
(`:jsoup` default or `:direct` - the
  well-forming half of the renderer, see above), `:shorten-urls` (default true), `:emoticons` (opt-in, like the
reference), `:typography` (default true), `:typography-locale`
(default "cs"; unknown falls back to English), `:hyphenation`
(default true) with `:word-limit` (default 20), `:indent` (default
true), `:line-wrap` (default 80, 0 disables), `:base-indent` (default
0), `:phrase-tags`
(replaces the phrase tag mapping, the reference Config::phraseTags),
`:figure-tag` (default `:figure`, the reference Config::figureTag;
the caption then renders in `figcaption`), `:figure-class` (default
none, the reference Config::figureClass); render options may be
given per `process` call.

## Custom handlers

The port's counterpart of the reference's `addLineSyntax` /
`addBlockSyntax` / `addPass`:

```clojure
;; a custom inline syntax: name, pattern, handler -> node(s) or nil
(def smiley (-> (texy/->texy)
                (texy/add-line-syntax "smiley" #":-?\)"
                                      (fn [_ _] {:type :smiley}))))

;; custom node types render through the multimethod
(defmethod work.gryphoon.texy.render/render-node :smiley [_]
  [[:span {:class "smiley"} ":-)"]])

(texy/process smiley "hi :)!")  ; => <p>hi <span class="smiley">:-)</span>!</p>
```

- `add-line-syntax` - an inline syntax. At the same offset the longer
  match wins, then earlier registration (custom syntaxes run after the
  built-ins). The handler `(fn [ctx groups])` returns a node map, a
  vector of nodes, or nil to refuse the match (other syntaxes at that
  position then get their turn, or the text stays plain).
- `add-block-syntax` - a block syntax. The pattern is compiled with the
  multiline flag (like the built-ins); the handler may consume
  continuation lines through the block parser
  (`work.gryphoon.texy.engine/block-next`, `work.gryphoon.texy.engine/block-move-backward`).
- `add-pass` - a transform pass, a function document -> document run
  after the built-in passes (heading balancing, link resolution);
  `work.gryphoon.texy.passes/transform-nodes` is the natural helper for writing one.

**Script (directive) handlers** - the `{{name ...}}` syntax, the port of
the reference's DirectiveModule:

```clojure
(def texy (-> (texy/->texy)
              (texy/add-directive "note"
                                  (fn [value args _]
                                    {:type :text :text (str "note: " value)}))
              ;; or catch directives with no named handler:
              (texy/set-fallback-directive some-handler)))

(texy/process texy "see {{note: hi}}")  ; => <p>see note: hi</p>
```

The directive pass runs first (before heading balancing):
`{{texy: a, b}}` is consumed into the document `:meta`; a registered
handler receives `(value args node)` (value is the raw argument string,
nil for a bare `{{name}}`; args are its comma-separated parts) and its
node replaces the directive - nil removes it; a directive with no
handler stays in the document and renders as the author wrote it.
See `test/work/gryphoon/texy/directive_test.clj`.

See `test/work/gryphoon/texy/custom_syntax_test.clj` for working examples, and
`test/work/gryphoon/texy/blog_setup_test.clj` for the translation of a full Texy 3
production setup: script handlers (directives), an image handler
(a pass), a block handler (a render-node override) and the module
configuration.

## Texy 3 link references (historical documents)

The 4-dev reference deprecates and IGNORES the label and modifier of a
`[ref]: url label .(title)[class]{style}` definition. For historical
documents this port restores the Texy 3 semantics, opt-in:

```clojure
(work.gryphoon.texy.core/->texy {:legacy-references true})  ; the Texy 3 reference semantics
                                              ; (implies the bare [ref] syntax;
                                              ; {"link/reference" true} in
                                              ; :allowed opts in just the
                                              ; syntax otherwise)
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
- `(core/add-definition texy name url label modifier)` carries the
  Texy 3 `Link::$label` / `Link::$modifier` (the modifier as written,
  with or without the leading dot)

Expected outputs verified against the actual Texy 3.2.8 (extracted from
the reference repository git tags) - see `test/work/gryphoon/texy/references_test.clj`.

## Architecture

- `work.gryphoon.texy.normalize` - line endings, trailing whitespace (the reference
  `Texy::normalize`).
- `work.gryphoon.texy.patterns` - the reference PCRE grammar translated to
  `java.util.regex` by hand: extended mode stripped, the ungreedy flag (U)
  inverted into explicit lazy quantifiers, possessive `++` kept.
- `work.gryphoon.texy.modifier` - the `.(title)[class]{style}<>^` modifier. The extent is
  found with a Java regex, the parts are structured by an
  [instaparse](https://github.com/engelenberg/instaparse) grammar - the one
  syntax in Texy that is a genuine CFG. `{name: value}` pairs become HTML
  attributes for names in the reference's `Modifier::ElAttrs` (or with a
  `data-`/`aria-` prefix), CSS styles otherwise.
- `work.gryphoon.texy.engine` - the two parsers: a stateful block parser exposed to
  handlers (they consume continuation lines via `block-next`, rewind via
  `block-move-backward`) and a leftmost-longest inline parser where a
  handler may refuse its match. Nodes are plain maps with a `:type` key;
  no source offsets/ranges are kept (documented simplification).
- `work.gryphoon.texy.modules` - the syntax handlers: paragraphs (line joining, hard
  breaks, whitespace-indented continuations), headings (underlined and
  surrounded, with dynamic level balancing), horizontal rules,
  blockquotes (a bare `>` line continues the quote, like the reference's
  empty /x alternative), (definition) lists, fenced code and `/--`
  blocks (code/div/html/text/comment/texysource - the reference's PCRE
  `(?0)` recursion is a depth-tracking line scanner, and the outdent
  strips per line only the prefix characters a line actually shares),
  tables (rowspan `^` continuation, colspan, column-modifier
  inheritance, head separators, multiline cells), phrases, wiki/markdown
  links, link and image definitions (`[ref]: url`, `[*ref*]: url`),
  images, figures (`[*img*]:link *** caption .mod`, the image part is
  atomic like the reference's `(?>...)`, so a line with two images is a
  paragraph, not a figure), autolinks, emoticons (opt-in), `{{...}}`
  directives (lazy matching - a directive closes at the first `}}`).
- `work.gryphoon.texy.html` - the HTML passthrough: tag/comment/entity line syntaxes,
  the HtmlPolicy port (tag whitelist, a/img validation, attribute
  filtering), and the pairing / sanitize passes. Entity decoding
  delegates to jsoup's full HTML5 entity table. Pairing keeps the
  reference's strict flatten semantics per content container - it is
  load-bearing, not jsoup-replaceable: the sanitize pass rejects
  paired elements by rendering BOTH tags as text, while jsoup would
  drop the orphan close tag. The global tag-stream repair is not done
  here - jsoup owns it at serialization time.
- `work.gryphoon.texy.passes` - bottom-up AST transforms (`transform-nodes` walks
  `:content`, `:items`, `:caption`, `:image`, `:rows` and `:cells`):
  heading balancing (with webalized ids for `{toc:}`), link-reference
  resolution (`[ref]` / `[*img*]` URLs resolve to their inner name; the
  `[*img*]` form additionally marks the link to use the image root, and
  the `[*ref*]::` self-link resolves against the image definitions).
- `work.gryphoon.texy.dom` - the HTML transform phase: a hicory-style facade over
  [jsoup](https://jsoup.org) (the jsoup-Document-to-hiccup conversion
  inlined). The rendered hiccup is serialized, parsed by jsoup - its
  HTML5 tree construction repairs the global tag stream (unclosed and
  crossed tags, prohibited nesting, raw script and style islands) -
  and converted back to hiccup. Tag-free raw blobs (the e-mail
  obfuscation entity, comment payloads) survive the parse round trip
  through base64 `<texy-raw>` placeholders. huff's void-element
  serialization is overridden to the HTML5 style here (`<br>`, not
  the XHTML `<br />`).
- `work.gryphoon.texy.typography` - typographic corrections (TypographyModule):
  the locale quote catalog and the substitution patterns over the
  TextRunPass marker alphabet (\x15 protected text, \x16 replaced
  content, \x17 markup boundary), plus the TextRunPass port itself:
  each inline container becomes one text image, block-level passthrough
  markup splits it into segments, the transformed image is written back
  into the text nodes. Runs as parse()'s last step, default on;
  `core/apply-typography` is the reference applyTypography.
- `work.gryphoon.texy.hyphenation` - soft-hyphen breaking of long words
  (HyphenationModule): words longer than `:word-limit` (default 20)
  split at heuristic syllable boundaries (the Czech/English
  vowel/consonant state machine). Runs as the second TextRunPass
  transformer, after typography; titles are never hyphenated and
  marker runs never split words. Default on.
- `work.gryphoon.texy.render` - the AST rendered to hiccup vectors, with jsoup's
  well-forming in between (see `work.gryphoon.texy.dom`). Serialization-time
  details of the reference renderer are ported: e-mail obfuscation (on
  by default), URL shortening for autolink display text (on by
  default), the `nofollow` class moving onto `rel="nofollow"`, and a
  render-time prohibited-ancestor pass (an `<a>` produced inside a
  link's content drops its tag, the text stays).
  The parse-only fragment path (`work.gryphoon.texy.render/to-html-fragment`, the
  `/--texysource` display) skips jsoup, like the reference's
  finalizeFragment.
- `work.gryphoon.texy.wellformer` - the serialization-time formatting of the
  reference WellFormer, fed by the well-formed hiccup tree: block
  elements indent with tabs, blank lines separate block siblings,
  lines wrap at 80 columns (breaks only between attributes and at
  spaces, never inside an attribute value or preserved content),
  text runs shrink to single spaces outside pre/textarea/script/code/
  samp/kbd. Options `:indent` (default true), `:line-wrap` (default
  80, 0 disables), `:base-indent`; fragments trim at both ends. The
  wordwrap counts UTF-8 bytes like PHP wordwrap() (4374-case oracle
  corpus replayed).
- `work.gryphoon.texy.text` - the plain-text renderer (the reference Output/Text
  Renderer): markup dropped, blocks separated by blank lines, list
  items one per line, table cells joined with tabs.

## Conformance

The conformance suite renders each original source
(`../texy-fixtures/sources/*.texy`) and compares with reference HTML generated
by the PHP oracle. Three fixture sets (all from
`tools/transform-oracle.php in the reference repository`):

- `--render-flat` writes `../texy-fixtures/render-flat/` (typography,
  hyphenation AND formatting disabled; this port runs with
  `{:indent false :line-wrap 0}` to match)
- `--render-typo-flat` writes `../texy-fixtures/render-typo-flat/` (typography on,
  formatting still flat)
- the full default configuration (typography + hyphenation + the
  WellFormer indentation and 80-column wrapping) writes
  `../texy-fixtures/render-full/` - this suite compares BYTE-FOR-BYTE
  including newlines and tabs, so the formatting port itself is
  oracle-verified (attributes are canonicalized: the two renderers
  emit them in different orders and wrap start tags at different
  boundaries, both irrelevant in HTML).

## Deviations from the reference

- **The global well-forming phase is jsoup's HTML5 tree construction**,
  not a port of the reference WellFormer's pairing half
  (`work.gryphoon.texy.dom`); the FORMATTING half is ported faithfully
  (`work.gryphoon.texy.wellformer` - indentation, wrapping, shrinking). The
  repairs mostly coincide, and jsoup additionally guarantees
  well-formed output; the accepted disagreements are the three
  conformance gaps:
  - nested `<a>` closes the outer link and opens a new one (adoption
    agency) where the reference drops the inner start tag; crossed
    inline tags nest rather than flatten;
  - `<script>`/`<style>` content stays raw until its real close tag,
    where the reference auto-closes at the first embedded comment;
  - an implicit `<tbody>` is inserted into passthrough tables
    (`<table><tr>` becomes `<table><tbody><tr>`);
  - bare boolean attributes (`<embed test>`) serialize as
    `test=""` (a DOM has no authorless attributes).
- **Entity decoding** delegates to jsoup's full HTML5 entity table -
  the same table the reference decodes with - plus the reference's
  `html_entity_decode` refusal semantics (refused codepoints stay
  literal, a NUL reference maps to U+FFFD, `&#12;` renders empty).
- **No image dimensions read from the filesystem** (the reference image
  module can measure local image files for width/height; this port
  renders images from the modifier only).
- **Locale independence**: every case conversion goes through the Unicode
  ROOT locale (work.gryphoon.texy.normalize/lower-case), like the reference's
  mb_strtolower (Texy never sets a locale) - the JVM default locale
  (Turkish, say) cannot change tag matching, directive/reference
  lookups or webalized ids. Clojure's str/lower-case uses the default
  locale and is not used.
- **Escaping** is done by this port (huff's own escaping is disabled):
  display text and code with `& < >` only (the reference's `ENT_NOQUOTES`
  - apostrophes stay literal); attribute values with `& " < >` (the
  reference's `formatAttrs`). The jsoup round trip decodes and re-encodes
  with the same functions (`work.gryphoon.texy.dom/wellform` receives them), so the
  escaping semantics are unchanged; tag-free raw blobs bypass the round
  trip entirely.
- E-mail obfuscation and URL shortening are on by default, like the
  reference renderer's defaults.
- `core/safe-mode` (the reference `Configurator::safeMode`): the safe
  tag whitelist, `:allowed-classes` / `:allowed-styles` false (no
  class/id/style from modifiers), URL schemes restricted, images /
  `[ref]:` definitions / HTML comments disabled, `rel=nofollow`.
  `core/add-definition` adds user-defined link references (the
  reference `addDefinition`); the 5-arity accepts the Texy 3
  `Link::$label` / `Link::$modifier` carriers. With
  `:legacy-references true` the Texy 3 reference semantics apply
  (see `work.gryphoon.texy.references-test`): the definition's label becomes the
  content of a bare `[ref]` use (the opt-in `"link/reference"`
  syntax), the definition's modifier applies to every use site under
  the use-site modifier, a `%s` in a reference URL takes the
  use-site text, and an image definition's modifier applies to
  `[*img*]` link targets. The `:allowed` map gates syntaxes by
  name like the reference `allowed[]`; ins/del/sup/sub phrases are
  opt-in, matching the reference defaults.
- Ordered list flavors render as `<ol>` with a `list-style-type` style,
  like the reference; a figure renders as `<figure>` with the caption in
  `<figcaption>` (`:figure-tag` swaps the wrapper, the caption element
  follows it) and the float written in the image brackets floats the
  figure itself, also like the reference.
- `alt` is always emitted on `<img>` (empty when the image has no
  alternative text) - the value is
  passed as a huff raw string so the empty attribute survives huff's
  omission of empty values.

## Tests

```
clojure -M:test        # clojure.test suite (unit + conformance), non-zero exit on failure

# first-difference printer for failing conformance sources (dev tool):
clojure -M:dev -e "(require 'work.gryphoon.texy.diff) (work.gryphoon.texy.diff/-main)"
```
