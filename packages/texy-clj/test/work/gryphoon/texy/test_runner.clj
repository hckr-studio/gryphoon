(ns work.gryphoon.texy.test-runner
  "clojure.test entry point: runs all test namespaces and exits nonzero on
  failure (the bundled clojure.test has no -main)."
  (:require [clojure.test :as test]
            [work.gryphoon.texy.normalize-test]
            [work.gryphoon.texy.modifier-test]
            [work.gryphoon.texy.parse-test]
            [work.gryphoon.texy.render-test]
            [work.gryphoon.texy.custom-syntax-test]
            [work.gryphoon.texy.directive-test]
            [work.gryphoon.texy.dom-test]
            [work.gryphoon.texy.typography-test]
            [work.gryphoon.texy.hyphenation-test]
            [work.gryphoon.texy.blog-setup-test]
            [work.gryphoon.texy.comment-setup-test]
            [work.gryphoon.texy.conformance-test]
            [work.gryphoon.texy.wellformer-test]
            [work.gryphoon.texy.references-test]))

(defn -main [& _]
  (let [{:keys [fail error]} (apply test/run-tests
                                    (map find-ns '[work.gryphoon.texy.normalize-test
                                                   work.gryphoon.texy.modifier-test
                                                   work.gryphoon.texy.parse-test
                                                   work.gryphoon.texy.render-test
                                                   work.gryphoon.texy.custom-syntax-test
                                                   work.gryphoon.texy.directive-test
                                                   work.gryphoon.texy.dom-test
                                                   work.gryphoon.texy.typography-test
                                                   work.gryphoon.texy.hyphenation-test
                                                   work.gryphoon.texy.blog-setup-test
                                                   work.gryphoon.texy.comment-setup-test
                                                   work.gryphoon.texy.conformance-test
                                                   work.gryphoon.texy.wellformer-test
                                                   work.gryphoon.texy.references-test]))]
    (System/exit (if (zero? (+ fail error)) 0 1))))
