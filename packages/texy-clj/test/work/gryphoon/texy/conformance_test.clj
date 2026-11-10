(ns work.gryphoon.texy.conformance-test
  "Conformance against the reference implementation's test material: the
  original sources (../texy-fixtures/sources/*.texy) rendered by this port and
  compared with the reference HTML.

  Three oracle fixture sets, all produced by
  implementations/node.js/tools/transform-oracle.php:

  - ../texy-fixtures/render-flat (the two reference-sources suites):
    typography, hyphenation AND the well-former formatting disabled;
    this port runs with {:indent false :line-wrap 0} to match
  - ../texy-fixtures/render-full (the formatted suite): the FULL default
    configuration - typography, hyphenation, block indentation and
    line wrapping at 80 all on - so the WellFormer formatting port
    (work.gryphoon.texy.wellformer) is verified byte-for-byte including newlines
    and tabs

  Start-tag attributes are sorted (attribute order differs between
  the two renderers and is semantically irrelevant in HTML); the
  flat suites additionally strip whitespace, the formatted suite
  preserves it everywhere outside start tags.

  Sources exercising syntaxes outside this port's subset are listed in
  `known-gaps` with the reason."
  (:require [clojure.test :refer [deftest is]]
            [clojure.string :as str]
            [work.gryphoon.texy.core :as core]))

(def sources-dir "../texy-fixtures/sources")
(def fixtures-dir "../texy-fixtures/render-flat")

(def known-gaps
  "Sources whose syntaxes are outside the ported subset."
  {;; the well-forming phase is jsoup's HTML5 tree construction (see
  ;; work.gryphoon.texy.dom and the README Deviations); these sources exercise the
  ;; places where it disagrees with the reference WellFormer
   "html" "jsoup repair semantics (crossed/unclosed inline tags, nested forms, paragraph wrapping)"
   "html-tags2" "jsoup repair semantics (script islands, bare boolean attributes)"
   ;; jsoup inserts an implicit <tbody> that the reference does not
   ;; emit for passthrough tables (accepted difference)
   "html-tags4" "implicit <tbody> in passthrough tables"})

(defn- canonicalize-tags
  "Sorts the attributes of every start tag: the two renderers emit
  attributes in different (insertion) orders; attribute order is
  semantically irrelevant in HTML, so both sides are sorted."
  ^String [^String html]
  (str/replace
    html
    #"<(\w[-\w]*)((?:\s+[-\w]+=\"[^\"]*\")*)\s*/?>"
    (fn [[_ tag attrs]]
      (let [pairs (->> (re-seq #"([-\w]+)=\"([^\"]*)\"" attrs)
                       (map (fn [[_ k v]] [(keyword k) v]))
                       (sort-by first)
                       (map (fn [[k v]] (str (name k) "=\"" v "\"")))
                       (str/join " "))]
        (str "<" tag (when-not (str/blank? pairs) (str " " pairs)) ">")))))

(defn normalize
  "Strips the reference's indentation whitespace and canonicalizes tag
  serialization on both sides."
  ^String [^String html]
  (-> html
      (str/replace #"[\n\t]" "")
      canonicalize-tags))

(defn fixtures
  "([fixtures-dir]) pairs of [name source expected] for every fixture
  (skipping the emoticon-enabled -on variants)."
  ([dir-name]
   (let [dir (java.io.File. dir-name)
         files (or (.listFiles dir) (throw (ex-info (str "fixtures dir not found: " dir-name)
                                                    {:dir (.getAbsolutePath dir)})))]
     (into []
           (comp (filter #(and (str/ends-with? % ".html")
                               (not (str/ends-with? % "-on.html"))))
                 (map #(let [name (str/replace % #"\.html$" "")]
                         [name
                          (slurp (str sources-dir "/" name ".texy"))
                          (slurp (str dir-name "/" %))])))
           (map #(.getName %) files))))
  ([] (fixtures fixtures-dir)))

(deftest reference-sources
  (let [fx (fixtures)]
    (is (pos? (count fx)) "no fixtures found - broken path?")
    (doseq [[name source expected] fx
            :when (not (contains? known-gaps name))]
      (is (= (normalize expected)
             ;; typography off: the flat fixtures are generated with the
             ;; typography, hyphenation and well-former formatting all off
             (normalize (core/process (core/->texy {:typography false :hyphenation false :indent false :line-wrap 0}) source)))
           (str "conformance: " name ".texy")))))

(deftest reference-sources-typography
  (let [fx (fixtures "../texy-fixtures/render-typo-flat")]
    (is (pos? (count fx)) "no render-typo fixtures found - broken path?")
    (doseq [[name source expected] fx
            :when (not (contains? known-gaps name))]
      (is (= (normalize expected)
             ;; typography on (the default), hyphenation and well-former
             ;; formatting still off - matching the render-typo oracle
             (normalize (core/process (core/->texy {:hyphenation false :indent false :line-wrap 0}) source)))
           (str "typo conformance: " name ".texy")))))

(defn- canonicalize-wrapped-tags
  "Sorts the attributes of every start tag (wrapped start tags
  included) and re-joins them with single spaces: attribute order and
  the exact wrap points inside a start tag differ between the two
  renderers, both semantically irrelevant in HTML. Whitespace
  EVERYWHERE ELSE is preserved - unlike `normalize`, this keeps the
  newlines and tabs the formatting suite verifies."
  ^String [^String html]
  (str/replace
    html
    #"<(\w[-\w]*)((?:[\s\n]+[-\w:]+=\"[^\"]*\")*)\s*/?>"
    (fn [[_ tag attrs]]
      (str "<" tag
           (if (str/blank? attrs)
             ""
             (str " " (str/join " " (sort (re-seq #"[-\w:]+=\"[^\"]*\"" attrs)))))
           ">"))))

(deftest reference-sources-formatted
  (let [dir (java.io.File. "../texy-fixtures/render-full")
        files (or (.listFiles dir)
                  (throw (ex-info "no render-full fixtures found - regenerate from the reference repo" {})))]
    (is (pos? (count files)))
    (doseq [^java.io.File f files
            :let [name (str/replace (.getName f) #"\.html$" "")]
            :when (not (contains? known-gaps name))]
      (let [emoticon? (= name "emoticon-on") ; the emoticon source with :emoticons true
            source (slurp (str sources-dir "/" (if emoticon? "emoticon" name) ".texy"))
            expected (slurp (str "../texy-fixtures/render-full/" (.getName f)))]
        (is (= (canonicalize-wrapped-tags expected)
               ;; the full default configuration: typography,
               ;; hyphenation, indentation and wrapping all ON
               (canonicalize-wrapped-tags (core/process (core/->texy {:emoticons true}) source)))
             (str "formatted conformance: " name ".texy"))))))
