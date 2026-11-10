(ns work.gryphoon.texy.wellformer.huge-benchmark
  "Benchmark for huge documents."
  (:require [work.gryphoon.texy.core :as texy]
            [work.gryphoon.texy.wellformer :as wf]
            [clojure.string :as str])
  (:gen-class))

(defn time-ns [f]
  (let [start (System/nanoTime)
        result (f)
        end (System/nanoTime)]
    [result (- end start)]))

(defn mean [coll]
  (/ (reduce + coll) (count coll)))

(defn benchmark [name f iterations]
  (println (format "\n=== %s (%d iterations) ===" name iterations))
  (let [times (doall (repeatedly iterations (fn [] (second (time-ns f)))))
        m (mean times)
        sd (let [variance (/ (reduce + (map #(Math/pow (- % m) 2) times)) (count times))]
             (Math/sqrt variance))
        min-time (apply min times)
        max-time (apply max times)]
    (println (format "Mean:   %.3f ms (%.0f ns)" (double (/ m 1e6)) (double m)))
    (println (format "StdDev: %.3f ms" (double (/ sd 1e6))))
    (println (format "Min:    %.3f ms" (double (/ min-time 1e6))))
    (println (format "Max:    %.3f ms" (double (/ max-time 1e6))))
    (println (format "Ops/sec: %.0f" (/ 1e9 (/ m iterations))))
    {:mean m :std-dev sd :min min-time :max max-time}))

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

(defn -main [& args]
  (println "Texy WellFormer Huge Document Benchmark")
  (println "=======================================")
  (println (format "Clojure version: %s" (clojure-version)))
  
  (let [warmup-iterations 5
        bench-iterations 20]
    
    ;; Warmup
    (println "\n[Warming up...]")
    (dotimes [_ warmup-iterations]
      (texy/process (texy/->texy) huge-doc))
    
    (println "Warmup complete.")
    
    ;; Huge document benchmarks
    (println "\n" (str/upper-case "Huge Document (~100KB) Benchmarks"))
    (println "---------------------------------------")
    (let [texy (texy/->texy)
          parsed (texy/parse texy huge-doc)
          rendered (texy/render-hiccup parsed)]
      (println (format "Document size: %d characters" (count huge-doc)))
      (println (format "Rendered size: %d forms" (count (flatten rendered))))
      
      (benchmark "Full pipeline (parse + render)" 
        (fn [] (texy/process texy huge-doc))
        bench-iterations)
      
      (benchmark "WellFormer serialize only" 
        (fn [] (wf/serialize rendered))
        bench-iterations)
      
      (benchmark "WellFormer with no indent" 
        (fn [] (wf/serialize rendered {:indent false}))
        bench-iterations)
      
      (benchmark "WellFormer with no line-wrap" 
        (fn [] (wf/serialize rendered {:line-wrap 0}))
        bench-iterations)
      
      (benchmark "WellFormer with no indent, no line-wrap" 
        (fn [] (wf/serialize rendered {:indent false :line-wrap 0}))
        bench-iterations))
    
    (println "\n" (str/upper-case "Benchmark Complete"))
    (println "======================================")))
