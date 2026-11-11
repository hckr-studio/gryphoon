(ns work.gryphoon.texy.diff-typo
  "Failing-case diff helper for the typography and formatted conformance
  suites (a dev tool outside the suite, like diff.clj)."
  (:require [clojure.string :as str]
            [work.gryphoon.texy.core :as core]
            [work.gryphoon.texy.conformance-test :as ct]))

(defn- canonicalize-wrapped-tags
  "The formatted suite's tag canonicalization (same normalization as
  conformance-test's, which keeps it private)."
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

(defn -main [& [which]]
  (let [full? (= which "full")
        dir (if full? "../texy-fixtures/render-full" "../texy-fixtures/render-typo-flat")
        cf (if full? canonicalize-wrapped-tags ct/normalize)]
    (doseq [[name source expected] (ct/fixtures dir)
            :when (not (contains? ct/known-gaps name))]
      (let [e (cf expected)
            opts (if full? {:emoticons true} {:hyphenation false :indent false :line-wrap 0})
            a (cf (core/process (core/->texy opts) source))]
        (when-not (= e a)
          (let [i (first (filter #(not= (nth e % nil) (nth a % nil)) (range (max (count e) (count a)))))
                i (or i 0)
                lo (max 0 (- i 70))]
            (println "=== " name " (at " i ")")
            (println "expected: ..." (pr-str (subs e lo (min (count e) (+ i 140)))))
            (println "actual:   ..." (pr-str (subs a lo (min (count a) (+ i 140)))))))))))
