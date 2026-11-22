(ns work.gryphoon.texy.patterns
  "Shared grammar patterns, kept in Java-regex syntax.

  The reference grammar is defined by PCRE patterns (docs/porting.md: \"the
  reference regexes are the authoritative grammar\"). This port translates
  them to java.util.regex by hand:

  - extended mode (x) whitespace/comments are stripped;
  - the ungreedy flag (U) is inverted into explicit lazy quantifiers
    (PCRE `X+` under U is lazy -> Java `X+?`; possessive `X++` stays);
  - `\\x{hhhh}` codepoint escapes are supported by Java as-is;
  - PCRE recursion `(?0)` is not used by the ported subset (the /-- blocks
    are not implemented)."
  (:require [clojure.string :as str]))

(def letter
  "The reference's Letter ranges (Patterns::Letter): ASCII, Latin
  Extended and Greek/Cyrillic blocks - deliberately NOT \\p{L}. This is
  the grammar - what the reference recognizes as syntax (CJK autolinks
  stay plain text) - so parse patterns keep it faithful; the typography
  nbsp rule is the deliberate all-scripts extension."
  "A-Za-z\\x{C0}-\\x{2FF}\\x{370}-\\x{1EFF}")

(def ^:private title-part "\\((?:\\\\\\)|[^)\\n])+\\)")
(def ^:private class-part "\\[[^\\]\\n]+\\]")
(def ^:private style-part "\\{[^}\\n]+\\}")

(defn modifier-pattern
  "The .(title)[class]{style} modifier, optionally with align parts.
  Bound is the maximum number of parts (3/4/5 in the reference). The parts
  are the capture (group N of the embedding pattern - always the first
  group the modifier contributes)."
  [& {:keys [align valign bound nc] :or {bound 3}}]
  (str "[ \t]*+(?<=[\t ]|^)\\." (if nc "(?:" "(") "(?:"
       (str/join "|" (concat [title-part class-part style-part]
                             (when align ["<>" ">" "=" "<"])
                             (when valign ["\\^" "-" "_"])))
       "){1," bound "})"))

(def modifier (modifier-pattern))
(def modifier-nc (modifier-pattern :nc true))
(def modifier-h (modifier-pattern :align true :bound 4))
(def modifier-hv (modifier-pattern :align true :valign true :bound 5))

;; links, url - doesn't end by :;,.!? and takes a ) only to close its own (,
;; parentheses balanced through a nested-paren run (the reference
;; Patterns::LinkUrl; the reference quotes it under the ungreedy flag, its
;; (greedy-in-U) body translated to a plain greedy one here, possessives
;; kept). Group N of the embedding pattern - always the first group the
;; target contributes.
(def link-url
  (str "\\[[^\\]\\n]++]"
       "|(?=[\\w/+.~%&?@=_#$])"
       "(?:[:;,.!?]*+(?:[^\\s():;,.!?]++|\\([^\\s()]{0,100}+\\)|\\())++"))

(def email
  (str "[" letter "][0-9.+_" letter "-]{0,63}@[0-9.+_"
       letter "-]{1,252}\\.[" letter "]{2,19}"))

(defn char-class
  "Wraps characters in a class, unless a single (possibly escaped) one
  speaks for itself."
  [chars]
  (if (re-matches #"(?:\\.|[^\\])" chars) chars (str "[" chars "]")))

(defn build-content-pattern
  "Builds the content (group 1), which runs by step to the first place where
  end matches, and end behind it - the reference buildContentPattern. The
  loop is possessive (Java supports it natively), so a long content takes no
  stack; the reference's (*SKIP) only skips start offsets on failure and
  never changes matches, so it is dropped. The end copy inside the lookahead
  (end-nc) uses the non-capturing modifier, like the reference's (?n:...)."
  [step end end-nc first]
  (str "(" (or first step) "(?:(?!" end-nc ")" step ")*+)" end))

(defn build-phrase-pattern
  "Builds the pattern of a paired phrase from its delimiter spec:
  (?<! guard) open (?! ...) content modifier? (?<! ...) close (?! ...)
  (:link)? - the content loop is the reference's stack-safe possessive
  buildContentPattern; the modifier/link stay greedy."
  [{:keys [open char close close-char guard guard-after before-open after-open
           before-close after-close content content-pair link multiline no-delimiter]
    :or {guard "" guard-after ""}}]
  (let [char (or char "")
        close-char (or close-char char)
        close (or close open)
        before-open (or before-open (char-class (str char guard)))
        after-open (or after-open (char-class (str "\\s" char guard-after)))
        before-close (or before-close (char-class (str "\\s" close-char guard)))
        after-close (or after-close (char-class (str close-char guard-after)))
        content (or content (str (if multiline "" "\\r\\n") " " close-char))
        content-pair (or content-pair (str " " (if no-delimiter "" close-char)))
        step (str "(?:[^" content "]++|[" content-pair "])")
        end (str "(?:" modifier ")?(?<!" before-close ")" close "(?!" after-close ")")
        end-nc (str "(?:" modifier-nc ")?(?<!" before-close ")" close "(?!" after-close ")")]
    (str
      "(?<!" before-open ")" open "(?!" after-open ")"
      (build-content-pattern step end end-nc nil)
      (when link (str "(?::(" link-url "))?")))))
