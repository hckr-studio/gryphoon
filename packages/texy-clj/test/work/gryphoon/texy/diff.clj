;; Failing-case diff helper, a dev tool outside the suite. Run with:
;;   clojure -M:dev -e "(require 'work.gryphoon.texy.diff) (work.gryphoon.texy.diff/-main)"
;; It prints the first differing region for each failing source.
(ns work.gryphoon.texy.diff
  (:require [clojure.string :as str]
            [work.gryphoon.texy.core :as core]
            [work.gryphoon.texy.conformance-test :as ct]))

(defn -main [& _]
  (doseq [[name source expected] (ct/fixtures)
          :when (not (contains? ct/known-gaps name))]
    (let [e (ct/normalize expected)
          a (ct/normalize (core/process (core/->texy {:typography false :hyphenation false
                                                      :indent false :line-wrap 0}) source))]
      (when-not (= e a)
        (let [i (first (filter #(not= (nth e % nil) (nth a % nil)) (range (max (count e) (count a)))))
              i (or i 0)
              lo (max 0 (- i 60))]
          (println "=== " name " (at " i ")")
          (println "expected: ..." (pr-str (subs e lo (min (count e) (+ i 120)))))
          (println "actual:   ..." (pr-str (subs a lo (min (count a) (+ i 120))))))))))
