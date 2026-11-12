(ns work.gryphoon.weblog.test-theme
  "A minimal WeblogTheme for the generator tests: a real Texy converter
  and deliberately plain, string-based markup, so the generator's own
  pipeline behavior can be asserted independently of any real site
  theme."
  (:require [work.gryphoon.texy.core :as texy]
            [work.gryphoon.weblog.generator :as generator]))

(defn converter []
  (texy/->texy))

(def theme
  (reify generator/WeblogTheme
    (texy [_ _config] (converter))
    (render-article [_ article _config]
      (str "<html><head><title>" (:title article) "</title></head><body>"
           "<h1>" (:title article) "</h1>" (:html article) "</body></html>"))
    (render-index [_ articles _config]
      (str "<html><head><title>Index</title></head><body><ul>"
           (apply str (map #(str "<li>" (:title %) "</li>") articles))
           "</ul></body></html>"))
    (render-category [_ data _config]
      (str "<html><head><title>" (:page-title data) "</title></head><body>"
           "<h1>" (:title data) "</h1>"
           (apply str (mapcat (fn [{:keys [articles]}]
                                (map #(str "<a>" (:title %) "</a>") articles))
                              (:years data)))
           "</body></html>"))))
