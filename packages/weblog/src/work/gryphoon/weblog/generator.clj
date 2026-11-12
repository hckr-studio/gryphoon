(ns work.gryphoon.weblog.generator
  "Gryphoon blog generator: the generic static-weblog engine, driven by a
  settings EDN map for a concrete site.

  Reads Texy articles (an EDN front matter header) from :paths/content /
  :weblog/section and generates into :paths/dist / :weblog/output: article
  pages, the weblog index, tag indexes, year/month/day indexes, a
  syndication feed page, RSS, sitemap.xml, cards.json for Open Graph
  images and legacy-URL redirects.

  The site markup is a WeblogTheme protocol implementation (see
  below): the settings :theme names the namespace whose `theme` var
  holds the theme instance; the engine resolves it with requiring-resolve.
  The engine post-processes the theme output per file: render-html (the
  void-tag serialization fix) on pages and indexes, not on the feed
  page, RSS and sitemap.

  Articles passed to the theme are enriched with :file-name,
  :published (Date), :timestamp, :year, :month, :day and the config-derived
  :permalink, :rel-link, :card-image, :author-handle, :author-fediverse.

  Settings keys (all read with get-in; :theme is the only required one):
    :theme         namespace whose `theme` var is the WeblogTheme
                   instance, e.g. \"rarousnet.weblog\"
    :site/title    site title (page-title suffix in the theme)
    :weblog        {:url site origin, :path section path under the origin,
                    :section content dir under content/, :output dist dir}
    :paths         {:content content dir under root, :dist dist dir under root}
    :locale        java.util.Locale name for the date formatters
    :formats       clj-time patterns: :long-date-time :long-date
                   :long-month-year :short-month :short-date :url-month
                   :url-day
    :authors       author name -> {:handle :fediverse}
    :labels        index page title prefixes: :tag :day :month :year
    :rss           {:limit :file :title :description :category
                   :copyright :generator}  ; the RSS channel metadata,
                   item count (default 10) and file (default articles.rss)
    :index         {:limit}             (default 5)
    :syndication   {:title :dir}        (default Syndication feed / weblog/feed)
    :cards         {:file :dir}         (default cards.json / ..)"
  (:require
    [clj-time.core :as time :refer [date-time]]
    [clj-time.coerce :as tc :refer [from-date]]
    [clj-time.format :as tf :refer [formatter unparse with-locale]]
    [clojure.edn :as edn]
    [clojure.core.reducers :as r]
    [net.cgrand.xforms :as x]
    [clojure.java.io :as io]
    [clojure.string :as string]
    [jsonista.core :as json]
    [net.cgrand.enlive-html :as html :refer [deftemplate xml-parser]]
    [work.gryphoon.texy.core :refer [process]])
  (:import
    (java.io File)
    (java.security MessageDigest)
    (java.text Normalizer Normalizer$Form)
    (java.util Locale)
    (java.util.regex Pattern)))

(set! *warn-on-reflection* true)

(def ^:private ^Pattern re-html-ext #"\.html$")
(def ^:private ^Pattern re-texy-ext #"\.texy$")
(def ^:private ^Pattern re-front-matter #"---")
(def ^:private ^Pattern re-spaces #"\s+")
(def ^:private ^Pattern re-dot #"\.")
(def ^:private ^Pattern re-hyphen #"-")
(def ^:private ^Pattern re-self-closing-tag #"\s/>")
(def ^:private ^Pattern re-file-separator #"/")

(defn remove-diacritics
  "Remove diacritical marks from the string `s`, e.g., 'żółw' is transformed
  to 'zolw'."
  [^String s]
  (let [normalized (Normalizer/normalize s Normalizer$Form/NFD)]
    (.replaceAll normalized "\\p{InCombiningDiacriticalMarks}+" "")))

(defn slug [^String s]
  (-> s
      (.toLowerCase)
      (remove-diacritics)
      (string/replace re-dot "-")
      (string/replace re-spaces "-")))

;;-------------------------------------------------- settings

(defn- weblog-url [config]
  (str (get-in config [:weblog :url]) (get-in config [:weblog :path])))

(defn- weblog-path [config]
  (get-in config [:weblog :path]))

(defn- date->dt [d]
  (if (instance? org.joda.time.ReadableInstant d) d (from-date d)))

(defn- unparse-fn [fmt]
  (fn [d] (unparse fmt (date->dt d))))

(defn formatters
  "The named date formatters as single-argument fns (each accepts a Date
  or a joda-time instant): :long-date-time :long-date :long-month-year
  :short-month :short-date :url-month :url-day :iso-date :rss-date."
  [config]
  (let [locale (when-let [l (:locale config)] (Locale. ^String l))
        f (fn [pattern]
            (unparse-fn (if locale
                          (with-locale (formatter pattern) locale)
                          (formatter pattern))))
        patterns (:formats config)]
    {:long-date-time (f (or (:long-date-time patterns) "d. MMMM yyyy"))
     :long-date (f (or (:long-date patterns) "d. MMMM yyyy"))
     :long-month-year (f (or (:long-month-year patterns) "MMMM yyyy"))
     :short-month (f (or (:short-month patterns) "MMM"))
     :short-date (f (or (:short-date patterns) "MMM d"))
     :url-month (f (or (:url-month patterns) "MM"))
     :url-day (f (or (:url-day patterns) "dd"))
     :iso-date (fn [d] (unparse (tf/formatters :date-time) (date->dt d)))
     :rss-date (fn [d] (unparse (tf/formatters :rfc822) (date->dt d)))}))

(defprotocol WeblogTheme
  "The site theme contract: the markup rendering for one article page,
  the weblog index page, a tag/time/syndication page and the RSS
  channel, plus the site's Texy converter. Every method receives the
  settings map; the contract returns enlive output (strings), the
  engine post-processes per file."
  (texy [theme config] "The Texy converter for the article content.")
  (render-article [theme article config] "One article full page, enlive output.")
  (render-index [theme articles config] "The weblog index page, enlive output.")
  (render-category [theme data config]
    "A tag/time/syndication page, enlive output; `data` =
    {:title :page-title :url :years}."))

;; The RSS channel (gryphoon/index.rss) is rendered by the engine: the
;; channel metadata comes from the :rss settings, the items from the
;; enriched articles.

(defn theme
  "The theme instance of the site: the var `theme` of the namespace
  named by the (config :theme) settings key, holding a WeblogTheme
  implementation."
  [config]
  @(requiring-resolve (symbol (:theme config) "theme")))

;;-------------------------------------------------- articles

(defn date [s]
  (->> s tc/from-string tc/to-date))

(defn ->article [input texy]
  (let [[_ meta & text] (string/split input re-front-matter)
        text (string/join "---" text)]
    (assoc (edn/read-string meta)
      :texy text
      :html (process texy text))))

(defn file-name [^File f]
  (let [x (fn [y m d & name] (str y "/" m "/" d "/" (string/join "-" name)))
        y (-> (.getName f)
              (string/replace re-texy-ext ".html")
              (string/split re-hyphen))]
    (apply x y)))

(defn convert [transform texy]
  (fn [^File f]
    (as-> f article
      (slurp article)
      (transform article texy)
      (assoc article
        :file-name (file-name f)
        :published (-> article :published date))
      (assoc article
        :timestamp (-> article :published tc/to-long)
        :year (-> article :published (date->dt) time/year)
        :month (-> article :published (date->dt) time/month)
        :day (-> article :published (date->dt) time/day)))))

(defn- enrich
  "Config-derived presentation fields; the theme stays a pure function of
  the article map and the config."
  [config article]
  (assoc article
    :permalink (str (weblog-url config) (:file-name article))
    :rel-link (str (weblog-path config) (:file-name article))
    :card-image (string/replace (str (weblog-url config) (:file-name article)) re-html-ext ".png")
    :author-handle (get-in config [:authors (:author article) :handle])
    :author-fediverse (get-in config [:authors (:author article) :fediverse])))

(def ^:private fold-chunk
  "Reducers' fold granularity: a task handles `fold-chunk` items - 32
  balances parallelism against scheduling overhead for the 6-10 ms item
  costs of this pipeline."
  32)

(defn read-articles
  "All articles of the site, enriched with the presentation fields.
  The Texy conversion is the hot phase: a reducers fold over the files,
  chunks combining in order, so the file-seq order stays the article
  order (cards.json, sitemap.xml and _redirects bytes depend on it)."
  [config content-root]
  (let [texy (texy (theme config) config)
        section (io/file content-root (get-in config [:weblog :section] "weblog"))
        files (into [] (remove (fn [^File f] (.isDirectory f))) (file-seq section))]
    (->> files
         (r/map #((convert ->article texy) %))
         (r/map #(enrich config %))
         (r/fold fold-chunk (r/monoid into vector) conj))))

;;-------------------------------------------------- output pipeline

(defn write-file [dist {:file/keys [name dir content append preppend]}]
  (let [file (.getCanonicalFile (io/file dist (or dir ".") name))
        file-path (.getCanonicalPath file)]
    (println "Writing file" file-path)
    (io/make-parents file-path)
    (if preppend
      (spit file (str content "\n" (slurp file)))
      (spit file content :append append))))

(defn latest [n articles]
  (->>
    articles
    (sort-by :timestamp >)
    (take n)))

(defn render-html [^CharSequence text]
  ;; TODO: fork enlive and make it spit correct self closing tags
  (string/replace text re-self-closing-tag ">"))

(defn- output-dir [config]
  (get-in config [:weblog :output] "weblog"))

(defn article-page
  "One article's full page as a file map."
  [config article]
  {:file/content (render-html (render-article (theme config) article config))
   :file/dir (output-dir config)
   :file/name (:file-name article)})

(defn articles-index [{:keys [articles config]}]
  (let [limit (get-in config [:index :limit] 5)]
    [{:file/name "index.html"
      :file/dir (output-dir config)
      :file/content (render-html (render-index (theme config) (latest limit articles) config))}]))

(deftemplate rss-template {:parser xml-parser} "gryphoon/index.rss" [config articles]
  [:title] (html/content (get-in config [:rss :title]))
  [:link] (html/content (weblog-url config))
  [:description] (html/content (get-in config [:rss :description]))
  [:copyright] (html/content (get-in config [:rss :copyright]))
  [:generator] (html/content (get-in config [:rss :generator]))
  [:category] (html/content (get-in config [:rss :category]))
  [:item] (html/clone-for [{:keys [author title description tags] :as article} articles]
            [:author] (html/content author)
            [:title] (html/content title)
            [:guid] (html/content (:permalink article))
            [:link] (html/content (:permalink article))
            [:pubDate] (html/content ((:rss-date (formatters config)) (:published article)))
            [:description] (html/content description)
            [:category] (html/clone-for [tag tags]
                          (html/content tag))))

(defn articles-rss [{:keys [articles config]}]
  (let [limit (get-in config [:rss :limit] 10)]
    [{:file/name (get-in config [:rss :file] "articles.rss")
      :file/dir (output-dir config)
      :file/content (apply str (rss-template config (latest limit articles)))}]))

(deftemplate sitemap-template {:parser xml-parser} "gryphoon/sitemap.xml" [links]
  [:url] (html/clone-for [link links]
           [:loc] (html/content link)))

(defn sitemap [{:keys [articles config]}]
  (let [homepage [(weblog-url config)]
        links (concat homepage (map :permalink articles))]
    [{:file/name "sitemap.xml"
      :file/dir (output-dir config)
      :file/content (apply str (sitemap-template links))}]))

(defn- category-page
  "One tag/time/syndication page through the theme."
  [config data]
  {:file/name (:url data)
   :file/dir (output-dir config)
   :file/content (render-html (render-category (theme config) data config))})

(defn tag-articles
  "The years structure of one tag: newest articles, grouped by year,
  newest year first."
  [[tag items]]
  [tag (->>
         items
         (sort-by :timestamp >)
         (group-by :year)
         (map #(zipmap [:year :articles] %))
         (sort-by :year >))])
(defn tag-tokens
  "One deferred category-page render per tag; the by-key transducer
  streams completed [tag articles] groups straight into the token
  construction - no intermediate tag->articles map is realized."
  [{:keys [articles config]}]
  (let [prefix (get-in config [:labels :tag] "Tag")]
    (eduction
      (mapcat (fn [article] (x/for [tag (:tags article)] [tag article])))
      (x/by-key (x/into []))
      (x/for [[tag items] _]
        (let [years (second (tag-articles [tag items]))]
          (fn [] (category-page config
                   {:title tag
                    :page-title (str prefix " " tag)
                    :url (str "tag/" (slug tag) ".html")
                    :years years}))))
      articles)))

(defn- day-data
  "The category data of one day index page."
  [config fmt year month]
  (fn [[day items]]
    (let [file-name (str year "/" (format "%02d" month) "/" (format "%02d" day) "/index.html")
          label (get-in config [:labels :day] "")
          title (str label " " ((:long-date fmt) (date-time year month day)))
          articles (->> items (sort-by (juxt :month :day)) (reverse))]
      {:title title
       :page-title title
       :url file-name
       :years [{:year year :articles articles}]})))

(defn- month-datas
  "One month's category data followed by its days'."
  [config fmt year]
  (fn [[month items]]
    (let [file-name (str year "/" (format "%02d" month) "/index.html")
          label (get-in config [:labels :month] "")
          title (str label " " ((:long-month-year fmt) (date-time year month)))
          articles
          (->>
            items
            (map second)
            (flatten)
            (sort-by (juxt :month :day))
            (reverse))
          month-data {:title title
                      :page-title title
                      :url file-name
                      :years [{:year year :articles articles}]}]
      (conj (map (day-data config fmt year month) items) month-data))))

(defn- year-datas
  "One year's category data followed by all its months' and days'."
  [config fmt]
  (fn [[year items]]
    (let [file-name (str year "/index.html")
          label (get-in config [:labels :year] "")
          title (str label " " year)
          articles
          (->>
            items
            (map second)
            (mapcat vals)
            (flatten)
            (sort-by (juxt :month :day))
            (reverse))
          year-data {:title title
                     :page-title title
                     :url file-name
                     :years [{:year year :articles articles}]}]
      (conj (mapcat (month-datas config fmt year) items) year-data))))

(defn articles-by-month [[month items]]
  [month (group-by :day items)])

(defn articles-by-year [[year items]]
  [year (->>
          items
          (group-by :month)
          (map articles-by-month))])

(defn time-tokens
  "One deferred category-page render per year/month/day index page."
  [{:keys [articles config]}]
  (let [fmt (formatters config)]
    (->> articles
         (group-by :year)
         (map (fn [entry] (articles-by-year entry)))
         (mapcat (year-datas config fmt))
         (map (fn [data] (fn [] (category-page config data)))))))

(defn syndication-feed [{:keys [articles config]}]
  (let [dir (get-in config [:syndication :dir] "weblog/feed")
        title (get-in config [:syndication :title] "Syndication feed")
        years
        (->>
          articles
          (group-by :year)
          (sort-by first >)
          (map (fn [[year articles]]
                 {:year year
                  :articles (sort-by :timestamp > articles)})))
        data {:title title
              :page-title title
              :url (str dir "/")
              :years years}
        ;; no render-html here: the feed page has always kept enlive's
        ;; XHTML void serialization (unlike the tag/time pages)
        html (render-category (theme config) data config)]
    [{:file/name "index.html"
      :file/dir dir
      :file/content html}]))

(defn- legacy-url [config article]
  (str (weblog-path config) (:id article) "-"
       (string/replace (last (string/split (:file-name article) re-file-separator)) re-html-ext ".aspx")))

(defn redirects [{:keys [articles config]}]
  [{:file/name "_redirects"
    :file/dir "."
    :file/content
    (transduce
      (comp
        (filter :id)
        (map #(str (legacy-url config %) " " (:rel-link %) " 301\n")))
      (fn
        ([] (StringBuilder.))
        ([^StringBuilder sb] (str sb))
        ([^StringBuilder sb, ^String line] (.append sb line)))
      articles)
    :file/preppend true}])

(defn article->image [article]
  {:title (:title article)
   :name (:author-handle article)
   :date (:published article)
   :tags (:tags article)
   :url (:card-image article)})

(defn sha256 [^String string]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256") (.getBytes string "UTF-8"))]
    (apply str (map #(format "%02x" %) digest))))

(defn hash-content [{:keys [title name date fileName] :as article}]
  (assoc article :hash (sha256 (str title name date fileName))))

(defn og-images [{:keys [articles config]}]
  (let [images-meta (into [] (comp (map article->image) (map hash-content)) articles)
        data (json/write-value-as-string images-meta)]
    [{:file/name (get-in config [:cards :file] "cards.json")
      :file/dir (get-in config [:cards :dir] "..")
      :file/content data}]))

(def ^:private singletons
  "The whole-collections, single-file generators."
  [og-images
   articles-rss
   sitemap
   syndication-feed
   articles-index
   redirects])

(defn- work
  "The whole schedule composed: one deferred render (a zero-arg fn
  returning the file map) per output file - singletons, article pages,
  tag indexes, time indexes. The tokens only describe the work:
  nothing renders until the single top fold's reduce steps invoke
  them."
  [{:keys [articles config] :as collections}]
  (concat
    (map (fn [gen] (fn [] (first (gen collections)))) singletons)
    (map (fn [article] (fn [] (article-page config article))) articles)
    (tag-tokens collections)
    (time-tokens collections)))

(defn run
  "Runs the whole generation for one site: `config` is the settings map
  (see the ns docstring), `root` the site repository root holding the
  content and the dist directory."
  [config root]
  (let [dist (.getCanonicalPath (io/file root (get-in config [:paths :dist] ".gryphoon/dist")))
        content-root (.getCanonicalFile (io/file root (get-in config [:paths :content] "content")))]
    (println)
    (println "Gryphoon - static weblog generator")
    (println)
    (println "Reading content...")
    (let [articles (read-articles config content-root)
          collections {:articles articles :config config}
          schedule (into [] (work collections))]
      (println "Generating content...")
      (let [written
            (r/fold fold-chunk
                    (r/monoid + (fn [] 0))
                    (fn [count token]
                      (write-file dist (token))
                      (inc count))
                    schedule)]
        (println)
        (println "DONE:" written "files")))))

(defn -main
  "Runs the generation for one site. `config-file` is the site settings
  EDN - the first CLI argument, falling back to `gryphoon.edn` in the
  working directory; `root` is the site repository root holding the
  content and the dist directory (default the parent directory)."
  [& [config-file root]]
  (run (edn/read-string (slurp (or config-file "gryphoon.edn")))
       (or root "..")))
