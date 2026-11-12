(ns work.gryphoon.texy.normalize
  "Normalizes text to the canonical form that parsing operates on (port of
  Texy::normalize): converts line endings to \\n, strips control characters and soft hyphens,
  right-trims lines and drops blank lines at both ends, keeping the newline
  that ends the last line, so a file stays a file. Idempotent.

  Also the home of locale-independent case conversion: the reference
  lowercases with mb_strtolower's Unicode default mappings and never
  sets a locale, so this port must not depend on the JVM's default
  locale either."
  (:require [clojure.string :as str])
  (:import
    (java.util Locale)
    (java.util.regex Pattern)))

(defn lower-case
  "Lowercases with the Unicode ROOT locale, independent of the JVM's
  default locale - like the reference's mb_strtolower. (clojure's
  str/lower-case uses String.toLowerCase() with the default locale: on
  a Turkish-locale JVM it would turn TITLE into tıtle with a dotless
  ı, breaking tag matching, directive and reference lookups.)"
  ^String [^String s]
  (.toLowerCase s Locale/ROOT))

(defn- strip-controls [s]
  (str/replace s #"[\x00-\x08\x0B-\x1F]+" ""))

(defn- strip-soft-hyphens
  "Removes soft hyphens, which get in by copy-pasting hyphenated text."
  [s]
  (str/replace s "\u00AD" ""))

(def ^:private line-end-trim
  (Pattern/compile "[ \t]+$" Pattern/MULTILINE))

(defn normalize ^String [^String text]
  (let [s (-> text
              (str/replace "\r\n" "\n")
              (str/replace "\r" "\n")
              strip-controls
              strip-soft-hyphens
              (str/replace line-end-trim "")   ; right trim line ends
              (str/replace #"^[\n\uFEFF]+" "")) ; BOM + blank lines at the start
        trimmed (str/replace s #"\n+$" "")]    ; blank lines at the end
    ;; the last line keeps its newline, so a file stays a file
    (if (and (not= trimmed s) (not= trimmed ""))
      (str trimmed "\n")
      trimmed)))
