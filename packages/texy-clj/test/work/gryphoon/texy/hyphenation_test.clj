(ns work.gryphoon.texy.hyphenation-test
  "Replays the hyphenation corpus captured from the reference
  HyphenationModule (implementations/node.js/tools/hyphenation-probe.php,
  one entry per input): Czech and English long words exercise the
  vowel/consonant state machine and the 0.6 * wordLimit spacing rule,
  entries with marker bytes (\\x15-\\x17) exercise the pseudo-character
  rule - markup runs never split words - and wordLimit variants cover
  non-default limits. Every entry must match the oracle exactly."
  (:require [clojure.data.json :as json]
            [clojure.test :refer [deftest is testing]]
            [work.gryphoon.texy.core :as core]
            [work.gryphoon.texy.hyphenation :as hyphenation]))

(def ^:private corpus
  (json/read-str (slurp "../texy-fixtures/hyphenation-corpus.json")))

(deftest corpus-coverage
  (is (= 42 (count corpus)) "the whole corpus must be replayed"))

(deftest corpus-replay
  (doseq [{:strs [input expected wordLimit] :as entry} corpus]
    (is (= expected (hyphenation/post-line input (or wordLimit 20)))
        (pr-str entry))))

(deftest word-break-characters
  (let [long "nejneobhospodařovávatelnějšími"
        ;; the oracle hyphenation of the same word (corpus entry 1)
        hyphenated "nejneobhospoda\u00ADřovávatelnější\u00ADmi"]
    ;; spaces, tabs and newlines break words: each long word is
    ;; hyphenated independently of its neighbours
    (is (= (str hyphenated " s " hyphenated "\t" hyphenated "\n" hyphenated)
           (hyphenation/post-line (str long " s " long "\t" long "\n" long))))))

(deftest short-words-untouched
  (is (= "Praha a Brno" (hyphenation/post-line "Praha a Brno"))))

;; the pipeline integration, expected values verified against the PHP
;; reference (flat output: indent and line wrap off)
(deftest pipeline-integration
  (let [long "nejneobhospodařovávatelnějšími"
        hyphenated "nejneobhospoda\u00ADřovávatelnější\u00ADmi"]
    (testing "runs as parse()'s last step, text inside phrases included"
      (is (= (str "<p>" hyphenated "</p>") (core/process (core/->texy {:indent false :line-wrap 0}) long)))
      (is (= (str "<p><strong>" hyphenated "</strong></p>")
             (core/process (core/->texy {:indent false :line-wrap 0}) (str "**" long "**")))))
    (testing "gated by :hyphenation, bounded by :word-limit"
      (is (= (str "<p>" hyphenated "</p>")
             ;; typography off, hyphenation still on (independent gates)
             (core/process (core/->texy {:indent false :line-wrap 0 :typography false}) long)))
      (is (= (str "<p>" long "</p>")
             (core/process (core/->texy {:indent false :line-wrap 0 :hyphenation false}) long)))
      (is (= (str "<p>" long "</p>")
             (core/process (core/->texy {:indent false :line-wrap 0 :word-limit 40}) long))))
    (testing "plain text strips the soft hyphens"
      (is (= (str long "\n") (core/to-text (core/->texy {:indent false :line-wrap 0}) long))))))
