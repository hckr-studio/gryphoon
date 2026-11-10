(ns work.gryphoon.texy.wellformer.benchmark
  "Benchmark suite for work.gryphoon.texy.wellformer to establish performance baseline."
  (:require [work.gryphoon.texy.core :as texy]
            [work.gryphoon.texy.wellformer :as wf]
            [clojure.string :as str])
  (:gen-class))

;; Helper for timing
(defn time-ns [f]
  (let [start (System/nanoTime)
        result (f)
        end (System/nanoTime)]
    [result (- end start)]))

(defn mean [coll]
  (/ (reduce + coll) (count coll)))

(defn std-dev [coll]
  (let [m (mean coll)
        variance (/ (reduce + (map #(Math/pow (- % m) 2) coll)) (count coll))]
    (Math/sqrt variance)))

(defn benchmark [name f iterations]
  (println (format "\n=== %s (%d iterations) ===" name iterations))
  (let [times (doall (repeatedly iterations (fn [] (second (time-ns f)))))
        m (mean times)
        sd (std-dev times)
        min-time (apply min times)
        max-time (apply max times)]
    (println (format "Mean:   %.3f ms (%.0f ns)" (double (/ m 1e6)) (double m)))
    (println (format "StdDev: %.3f ms" (double (/ sd 1e6))))
    (println (format "Min:    %.3f ms" (double (/ min-time 1e6))))
    (println (format "Max:    %.3f ms" (double (/ max-time 1e6))))
    (println (format "Ops/sec: %.0f" (/ 1e9 (/ m iterations))))
    {:mean m :std-dev sd :min min-time :max max-time :ops-per-sec (/ 1e9 (/ m iterations))}))

;; Test documents of various sizes

;; Small document - basic paragraph with formatting
(def small-doc
  "This is a **small** document with some _formatting_ and a [link](http://example.com).")

;; Medium document - typical blog post paragraph
(def medium-doc
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. **Ut enim ad minim veniam**, quis nostrud exercitation ullamco _laboris nisi ut aliquip ex ea commodo_ consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

- List item 1
- List item 2
- List item 3

Another paragraph with more content and [another link](#anchor).")

;; Large document - multiple paragraphs, lists, code blocks
(def large-doc
  (str/join "\n\n"
    [(str/join "\n" (repeat 5 "# Heading 1"))
     (str/join "\n\n" (repeat 10 "This is a paragraph with **bold** and _italic_ text. It also contains [links](http://example.com) and some `code`. The quick brown fox jumps over the lazy dog."))
     "```clojure
(defn example []
  (let [x 1
        y 2]
    (+ x y)))
```"
     (str/join "\n" (repeat 20 "- List item with **bold** text"))
     "| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| A | B | C |
| D | E | F |"
     (str/join "\n\n" (repeat 5 "Another paragraph here with more content and formatting."))]))

;; Huge document - 100KB+ of content
(def huge-doc
  (let [paragraph "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."
        list-item "- List item with **bold** and _italic_ text and a [link](http://example.com)"
        code-block "```clojure
(defn example []
  (let [x 1]
    x))
```"]
    (str/join "\n\n"
      [(str/join "\n\n" (repeat 50 paragraph))
       (str/join "\n" (repeat 100 list-item))
       (str/join "\n\n" (repeat 20 code-block))
       (str/join "\n\n" (repeat 50 paragraph))])))

;; Very large document - 1MB+
;; (commented out for now as it may be too big)
;; (def very-large-doc (str/join "\n\n" (repeat 100 huge-doc)))

(defn -main [& args]
  (println "Texy WellFormer Performance Benchmark")
  (println "======================================")
  (println (format "Clojure version: %s" (clojure-version)))
  (println (format "Available processors: %d" (.availableProcessors (Runtime/getRuntime))))
  (println (format "Max memory: %.1f MB" (/ (.maxMemory (Runtime/getRuntime)) 1e6)))
  
  (let [warmup-iterations 10
        bench-iterations 100]
    
    ;; Warmup
    (println "\n[Warming up...]")
    (dotimes [_ warmup-iterations]
      (texy/process (texy/->texy) small-doc)
      (texy/process (texy/->texy) medium-doc)
      (wf/serialize [:p "test"])
      (wf/wordwrap "test string" 80))
    
    (println "Warmup complete.")
    
    ;; Small document benchmarks
    (println "\n" (str/upper-case "Small Document Benchmarks"))
    (println "---------------------------------------")
    (let [texy (texy/->texy)
          parsed (texy/parse texy small-doc)
          rendered (texy/render-hiccup parsed)]
      (benchmark "Full pipeline (parse + render)" 
        (fn [] (texy/process texy small-doc))
        bench-iterations)
      (benchmark "WellFormer serialize only" 
        (fn [] (wf/serialize rendered))
        bench-iterations))
    
    ;; Medium document benchmarks
    (println "\n" (str/upper-case "Medium Document Benchmarks"))
    (println "---------------------------------------")
    (let [texy (texy/->texy)
          parsed (texy/parse texy medium-doc)
          rendered (texy/render-hiccup parsed)]
      (benchmark "Full pipeline (parse + render)" 
        (fn [] (texy/process texy medium-doc))
        bench-iterations)
      (benchmark "WellFormer serialize only" 
        (fn [] (wf/serialize rendered))
        bench-iterations))
    
    ;; Large document benchmarks
    (println "\n" (str/upper-case "Large Document Benchmarks"))
    (println "---------------------------------------")
    (let [texy (texy/->texy)
          parsed (texy/parse texy large-doc)
          rendered (texy/render-hiccup parsed)]
      (benchmark "Full pipeline (parse + render)" 
        (fn [] (texy/process texy large-doc))
        (/ bench-iterations 5))
      (benchmark "WellFormer serialize only" 
        (fn [] (wf/serialize rendered))
        (/ bench-iterations 5)))
    
    ;; Configuration variations
    (println "\n" (str/upper-case "Configuration Variations (Medium Document)"))
    (println "---------------------------------------")
    (let [base-iterations 50]
      (benchmark "No indent, no line-wrap" 
        (fn [] (texy/process (texy/->texy {:indent false :line-wrap 0}) medium-doc))
        base-iterations)
      (benchmark "No indent" 
        (fn [] (texy/process (texy/->texy {:indent false}) medium-doc))
        base-iterations)
      (benchmark "No line-wrap" 
        (fn [] (texy/process (texy/->texy {:line-wrap 0}) medium-doc))
        base-iterations))
    
    ;; Individual function benchmarks
    (println "\n" (str/upper-case "Individual Function Benchmarks"))
    (println "---------------------------------------")
    (let [test-string (str/join (repeat 1000 "word "))
          width 80]
      (benchmark "wordwrap function (1000 words)" 
        (fn [] (wf/wordwrap test-string width))
        bench-iterations))
    
    ;; freeze-spaces benchmark
    (println "\n")
    (let [test-string (str/join (repeat 100 "a b\tc d\ne f\rg h"))]
      (benchmark "freeze-spaces function" 
        (fn [] (wf/freeze-spaces test-string))
        bench-iterations))
    
    ;; skip format-attrs as it's private
    
    (println "\n" (str/upper-case "Benchmark Complete"))
    (println "======================================")))
