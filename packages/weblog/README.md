# Gryphoon weblog

Generic static weblog generator (`work.gryphoon.weblog.generator`): reads
Texy articles with an EDN front matter and generates article pages, the
weblog index, tag and year/month/day indexes, a syndication feed page,
RSS, `sitemap.xml`, `cards.json` for Open Graph images and legacy-URL
redirects. Article conversion is `work.gryphoon/texy-clj` (the `../texy-clj`
sibling in this monorepo).

A concrete site is a settings EDN plus a *theme* - a `WeblogTheme`
protocol implementation carrying the markup (enlive templates and the
Texy converter setup).

## Usage

```bash
clojure -M -m work.gryphoon.weblog.generator site.edn ..   # settings file + site root

clojure -M -m work.gryphoon.weblog.generator               # falls back to ./gryphoon.edn, root ..
```

Programmatic: `(work.gryphoon.weblog.generator/run config site-root)`.

## Settings

Only `:theme` is required; everything else has a documented default.

```edn
{:theme "my-site.weblog"       ; namespace whose `theme` var is the WeblogTheme instance
 :site {:title "my-site"}
 :weblog {:url "https://www.example.net"
          :path "/weblog/"          ; section path under the url
          :section "weblog"         ; content dir under content/
          :output "weblog"}         ; dist dir written
 :paths {:content "content"
         :dist ".gryphoon/dist"}
 :locale "cs"
 :formats {:long-date-time "HH.mm - d. MMMM yyyy"
           :long-date       "d. MMMM yyyy"
           :long-month-year "MMMM yyyy"
           :short-month     "MMM"
           :short-date      "MMM d"
           :url-month       "MM"
           :url-day         "dd"}
 :authors {"Jane Doe" {:handle "@jane@example.social"
                       :fediverse "@jane@example.social"}}
 :labels {:tag "Tag" :day "Denník" :month "Měsíčník" :year "Ročenka"}
 :rss         {:limit 10 :file "articles.rss"}
 :index       {:limit 5}
 :syndication {:title "Syndication feed" :dir "weblog/feed"}
 :cards       {:file "cards.json" :dir ".."}}
```

## WeblogTheme protocol

The theme namespace (settings `:theme`) must define a var `theme` holding
an instance implementing `work.gryphoon.weblog.generator/WeblogTheme`:

| method                                        | returns                                        |
| --------------------------------------------- | ---------------------------------------------- |
| `(texy theme config)`                         | the Texy converter for the article content      |
| `(render-article theme article config)`      | one article full page, enlive output           |
| `(render-index theme articles config)`       | the weblog index page, enlive output           |
| `(render-category theme data config)`        | a tag/time/syndication page, enlive output    |

`render-category` data: `{:title :page-title :url :years}`.

The RSS feed (`gryphoon/index.rss`, a package resource) is rendered by the
engine itself: the channel metadata comes from the `:rss` settings
(`:title :description :category :copyright :generator`) and the items from
the enriched articles.

Each article map passed to the theme carries the front matter plus
`:texy`, `:html` (converted), `:file-name` (`YYYY/MM/DD/slug.html`),
`:published` (Date), `:timestamp`, `:year`, `:month`, `:day` and the
config-derived `:permalink`, `:rel-link`, `:card-image`,
`:author-handle`, `:author-fediverse`. Date formatting goes through
`(work.gryphoon.weblog.generator/formatters config)` - named
single-argument unparse fns accepting a `Date` or a joda time instant;
`slug` and `render-html` are public helpers there too.

The engine post-processes the theme output per file: `render-html` (the
void-tag serialization fix) on pages and indexes, but not on the feed
page, RSS and sitemap (historical behavior).

Theme templates typically live on the site's classpath (the source tree
and/or the built dist directory), one enlive resource per template.

## Parallelism

The pipeline is composed as transducer-style deferred work: `read-articles`
folds the Texy conversion (chunks combining in order, keeping the file-seq
order the output order), and every output file is a *token* - a zero-arg fn
returning the file map, built from cheap grouping metadata only. Nothing
renders until the single top fold in `run` reduces a token:

```clojure
(r/fold fold-chunk (r/monoid + (fn [] 0))
  (fn [count token] (write-file dist (token)) (inc count))
  schedule)                                     ; counted token vector
```

The schedule vector is the only realization (closures, not renders) - a
counted source the fork/join fold splits into balanced tasks, one flat
fold over all ~1.3k renders+writes. No nested folds, no worker starvation:
the default common pool is enough; total build of 464 articles / 1331
files lands around 5-6 s wall on 10 cores (JVM start included, ~13-15 s
before the parallelization).
