(ns work.gryphoon.texy.wellformer.wordwrap-benchmark
  "Focused benchmark for wordwrap function."
  (:require [work.gryphoon.texy.wellformer :as wf]
            [clojure.string :as str])
  (:gen-class))

(defn time-ns [f]
  (let [start (System/nanoTime)
        result (f)
        end (System/nanoTime)]
    [result (- end start)]))

(defn mean [coll]
  (double (/ (reduce + coll) (count coll))))

(defn benchmark [name f iterations warmup]
  (let [warmup-iterations warmup]
    ;; Warmup
    (dotimes [_ warmup-iterations] (f))
    
    ;; Benchmark
    (let [times (doall (repeatedly iterations (fn [] (second (time-ns f)))))
          m (mean times)
          sd (let [variance (/ (reduce + (map #(Math/pow (- % m) 2) times)) (count times))]
               (Math/sqrt variance))
          min-time (double (apply min times))
          max-time (double (apply max times))]
      (println (format "%-50s Mean: %8.3f ms  StdDev: %6.3f ms  Min: %8.3f ms  Max: %8.3f ms  Ops/sec: %12.0f" 
               name (double (/ m 1e6)) (double (/ sd 1e6)) (double (/ min-time 1e6)) (double (/ max-time 1e6)) (/ 1e9 (/ m iterations))))
      {:name name :mean m :std-dev sd :min min-time :max max-time})))

(defn -main [& args]
  (println "Wordwrap Performance Benchmark")
  (println "==============================")
  (println (format "Clojure version: %s" (clojure-version)))
  (println)
  
  (let [iterations 1000
        warmup 50]
    
    (println "WORDWRAP BENCHMARKS")
    (println "-----------------")
    
    (let [short-string (str/join (repeat 10 "word "))
          medium-string (str/join (repeat 100 "word "))
          long-string (str/join (repeat 1000 "word "))
          very-long-string (str/join (repeat 5000 "word "))]
      
      (println (format "Short string (%d chars):" (count short-string)))
      (benchmark "  wordwrap width=80" (fn [] (wf/wordwrap short-string 80)) iterations warmup)
      
      (println (format "\nMedium string (%d chars):" (count medium-string)))
      (benchmark "  wordwrap width=80" (fn [] (wf/wordwrap medium-string 80)) iterations warmup)
      
      (println (format "\nLong string (%d chars):" (count long-string)))
      (benchmark "  wordwrap width=80" (fn [] (wf/wordwrap long-string 80)) iterations warmup)
      
      (println (format "\nVery long string (%d chars):" (count very-long-string)))
      (benchmark "  wordwrap width=80" (fn [] (wf/wordwrap very-long-string 80)) iterations warmup)
      
      (println (format "\nLong string with different widths:"))
      (benchmark "  wordwrap width=40" (fn [] (wf/wordwrap long-string 40)) iterations warmup)
      (benchmark "  wordwrap width=120" (fn [] (wf/wordwrap long-string 120)) iterations warmup)
      (benchmark "  wordwrap width=200" (fn [] (wf/wordwrap long-string 200)) iterations warmup))
    
    (println "\nBenchmark Complete")))
