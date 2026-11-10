(ns run-corpus
  "Corpus runner for the Clojure port: converts {file: body} JSON on stdin
  to {file: html} JSON on stdout, configured like the rarousnet production
  setup (the same handlers as the work.gryphoon.texy.blog-setup-test). Conversion time is
  printed to stderr."
  (:require [clojure.string :as str]
            [clojure.data.json :as json]
            [work.gryphoon.texy.core :as core]
            [work.gryphoon.texy.modules :as modules]
            [work.gryphoon.texy.passes :as passes]
            [work.gryphoon.texy.render :as render]))

(defn- raw-url-encode
  "PHP rawurlencode: percent encoding with spaces as %20 (URLEncoder is
  form encoding, spaces would come out as +)."
  [s]
  (str/replace (java.net.URLEncoder/encode s "UTF-8") "+" "%20"))

(defn- player
  "A player iframe as an AST html-element node: raw markup in the
  output, its attributes validated by the sanitize pass like any
  passthrough element. Attributes mirror the reference corpus runner
  exactly - same order, allowfullscreen as the empty string (the
  reference's allowfullscreen=\"\")."
  [{:keys [src width height cls title allow allowfullscreen data-ratio]}]
  {:type :html-element
   :name "iframe"
   :attrs (cond-> {"loading" "lazy"}
            true (assoc "width" width)
            true (assoc "height" height)
            cls (assoc "class" cls)
            allowfullscreen (assoc "allowfullscreen" "")
            data-ratio (assoc "data-ratio" data-ratio)
            title (assoc "title" title)
            allow (assoc "allow" allow)
            true (assoc "src" src))
   :content []})

(defn- script-handler
  "The script handler: one fallback dispatching on the directive name.
  Unknown directives render as the author wrote them (the proceed default)."
  [_value args node]
  (let [{:keys [name]} (modules/parse-directive-content (:text node))]
    (case name
      "mixcloud-mini"
      (player {:src (str "https://www.mixcloud.com/widget/iframe/?hide_cover=1&light=1&mini=1&feed="
                         (raw-url-encode (first args)) "&" (or (second args) ""))
               :width "560" :height "60"
               :cls "player mixcloud-player mixcloud-player--mini"})
      "mixcloud"
      (player {:src (str "https://www.mixcloud.com/widget/iframe/?hide_cover=1&light=1&feed="
                         (raw-url-encode (first args)) "&" (or (second args) ""))
               :width "560" :height "120"
               :cls "player mixcloud-player"})
      "speakerdeck"
      (player {:src (str "https://speakerdeck.com/player/" (raw-url-encode (first args)))
               :width "560" :height "420"
               :cls "player speakerdeck"
               :allowfullscreen true
               :data-ratio "1.3333333333333333"})
      "spotify"
      (player {:src (str "https://open.spotify.com/embed/episode/" (first args))
               :width "560" :height "152"
               :cls "player spotify-player"
               :allowfullscreen true
               :allow "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"})
      "youtube"
      (player {:src (str "https://www.youtube-nocookie.com/embed/" (first args))
               :width "560" :height "315"
               :cls "player youtube-player"
               :title "YouTube video player"
               :allowfullscreen true
               :allow "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"})
      ;; default: proceed()
      {:type :text :text (str "{{" (:text node) "}}")})))

(defn- image-handler-pass
  "The image handler: every image gets loading=lazy and sizes=100vw
  (Client Hints)."
  [doc]
  (passes/transform-nodes
    (fn [node]
      (if (= :image (:type node))
        (update-in node [:modifier :attrs] (fnil merge {})
                   {"loading" "lazy" "sizes" "100vw"})
        node))
    doc))

(defn- prism-code-renderer
  "The block handler as a render-node override: Prism.js wants
  language-<lang> on the <code> element and no language class on the <pre>."
  [original node]
  (if (and (= :code (:style node :code)) (seq (:language node)))
    (let [code-text (first (render/render-node {:type :text :text (:code node)}))]
      [[:pre
        [:code {:class (str "language-" (:language node))} code-text]]])
    (original node)))

(defn blog-texy []
  (-> (core/->texy
        {:top 3
         :generate-ids true
         :legacy-references true
         :well-forming :direct
         :image-root "https://res.cloudinary.com/rarous/image/fetch/dpr_auto,f_auto,q_auto,w_auto:100:800/https://www.rarous.net/data/obrazky/"
         :phrase-tags (merge render/phrase-tags {"phrase/em" :i})
         :figure-class "image"
         :allowed {"phrase/ins" true "phrase/del" true "phrase/sup" true "phrase/sub" true}})
      (core/set-fallback-directive script-handler)
      (core/add-pass image-handler-pass)))

(defn -main []
  (let [articles (json/read-str (slurp "/tmp/blog-corpus.json"))
        texy (blog-texy)
        original (get (methods render/render-node) :code-block)]
    (defmethod render/render-node :code-block [node]
      (prism-code-renderer original node))
    (flush)
    (let [start (System/nanoTime)
          output (into (sorted-map)
                       (map (fn [[file text]]
                              [file (core/process texy text)]))
                       articles)
          elapsed (/ (- (System/nanoTime) start) 1e6)]
      (binding [*out* *err*]
        (println (str "conversion of " (count articles) " articles took " (format "%.1f" elapsed) " ms")))
      (print (json/write-str output))
      (flush))
    (shutdown-agents)))

(-main)
