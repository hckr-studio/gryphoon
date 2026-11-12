(ns work.gryphoon.weblog.generator-test
  "Unit tests for the weblog generator: the pure helpers directly, the
  collection generators (RSS, sitemap, redirects, cards.json, tag and
  time indexes) with fixture articles against the test theme, and the
  full run over a temp site tree.

  Run: clojure -M:test -m work.gryphoon.weblog.generator-test"
  (:require [clojure.java.io :as io]
            [clojure.string :as string]
            [clojure.test :as t :refer [are deftest is testing use-fixtures]]
            [jsonista.core :as json]
            [work.gryphoon.weblog.generator :as gen]
            [work.gryphoon.weblog.test-theme :as test-theme]))

(def ^:dynamic *tmp*)

(use-fixtures
  :each
  (fn [f]
    (let [tmp (io/file (System/getProperty "java.io.tmpdir")
                       (str "gryphoon-generator-test-" (System/nanoTime)))
          delete! (fn delete! [^java.io.File f]
                    (when (.isDirectory f)
                      (doseq [child (.listFiles f)] (delete! child)))
                    (.delete f))]
      (.mkdirs tmp)
      (binding [*tmp* tmp]
        (try (f) (finally (delete! tmp)))))))

(def base-config
  {:theme "work.gryphoon.weblog.test-theme"
   :site {:title "Test site"}
   :weblog {:url "https://example.com" :path "/weblog/"
            :section "weblog" :output "weblog"}
   :paths {:content "content" :dist ".gryphoon/dist"}
   :locale "en"
   :authors {"Ales R" {:handle "rarous" :fediverse "rarous@example.social"}}
   :labels {:tag "Tag" :day "Day" :month "Month" :year "Year"}
   :rss {:title "Test feed" :description "A test weblog"
         :category "tech" :copyright "2024 Ales R" :generator "gryphoon"}})

(defn article
  "A fixture article map for the collection-level generators."
  [m]
  (merge {:title "Untitled"
          :author "Ales R"
          :description "A test article"
          :tags []
          :published (gen/date "2024-06-01T10:00:00.000Z")
          :year 2024 :month 6 :day 1
          :timestamp 1717236000000}
         m))

(defn front-matter [meta body]
  (str "---\n" (pr-str meta) "\n---\n" body "\n"))

;;-------------------------------------------------- pure helpers

(deftest removing-diacritics
  (are [in out] (= out (gen/remove-diacritics in))
    "café" "cafe"
    "žlutý" "zluty"
    "urso" "urso")
  (is (= "aeiou" (gen/remove-diacritics "áéíóú"))))

(deftest slugging
  (are [in out] (= out (gen/slug in))
    "Hello world" "hello-world"
    "Žluťoučký kůň" "zlutoucky-kun"
    "Iron.Maiden" "iron-maiden"
    "HTML a CSS" "html-a-css"))

(deftest hashing-sha256
  (is (= "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
         (gen/sha256 "abc")))
  (is (= "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
         (gen/sha256 ""))))

(deftest hashing-content
  (let [a {:title "Hello world" :name "rarous"
           :date (gen/date "2024-05-10T10:00:00.000Z")
           :fileName "hello-world.html"}
        h (:hash (gen/hash-content a))]
    (is (re-matches #"[0-9a-f]{64}" h))
    (is (= h (:hash (gen/hash-content a))))
    (is (not= h (:hash (gen/hash-content (assoc a :title "Bye")))))))

(deftest parsing-dates
  (let [d (gen/date "2024-06-01T10:00:00.000Z")]
    (is (instance? java.util.Date d))
    (is (= 1717236000000 (.getTime d)))))

(deftest date-formatters
  (let [fmt (gen/formatters base-config)
        d (gen/date "2024-05-10T10:30:00.000Z")]
    (is (= "2024-05-10T10:30:00.000Z" ((:iso-date fmt) d)))
    (is (= "05" ((:url-month fmt) d)))
    (is (= "10" ((:url-day fmt) d)))
    (is (= "May 10" ((:short-date fmt) d)))
    (is (= "10. May 2024" ((:long-date fmt) d)))
    (is (= "May 2024" ((:long-month-year fmt) d)))))

(deftest custom-date-formats
  (let [fmt (gen/formatters (assoc base-config
                                   :formats {:url-month "M" :long-date "d/M/yyyy"}))
        d (gen/date "2024-05-10T10:30:00.000Z")]
    (is (= "5" ((:url-month fmt) d)))
    (is (= "10/5/2024" ((:long-date fmt) d)))))

(deftest deriving-file-names
  (are [name path] (= path (gen/file-name (io/file name)))
    "2024-06-01-hello-world.texy" "2024/06/01/hello-world.html"
    "2023-12-31-recap.texy" "2023/12/31/recap.html"))

(deftest parsing-articles
  (let [a (gen/->article
            (front-matter {:title "Hello world" :tags ["clojure"]
                           :published "2024-06-01T10:00:00.000Z"}
                           "**Hello** world")
            (test-theme/converter))]
    (is (= "Hello world" (:title a)))
    (is (= ["clojure"] (:tags a)))
    (is (string/includes? (:texy a) "**Hello** world"))
    (is (string/includes? (:html a) "<strong>Hello</strong> world"))))

(deftest latest-articles
  (let [articles (map (fn [n] {:title (str "post-" n) :timestamp n}) (range 6))]
    (is (= ["post-5" "post-4" "post-3"] (mapv :title (gen/latest 3 articles))))
    (is (= 6 (count (gen/latest 10 articles))))))

(deftest rendering-html-void-tags
  (are [in out] (= out (gen/render-html in))
    "<br />" "<br>"
    "<img src=\"x\" />" "<img src=\"x\">"
    "<p />" "<p>"))

;;-------------------------------------------------- collection structure

(deftest grouping-articles-by-day-and-year
  (let [a1 (article {:title "June first" :year 2024 :month 6 :day 1 :timestamp 20})
        a2 (article {:title "June second" :year 2024 :month 6 :day 2 :timestamp 10})
        a3 (article {:title "Old" :year 2023 :month 6 :day 1 :timestamp 0})
        [month day-groups] (gen/articles-by-month [6 [a1 a2 a3]])]
    (is (= 6 month))
    (is (= [1 2] (sort (keys day-groups))))
    (let [[year month-groups] (gen/articles-by-year [2024 [a1 a2]])]
      (is (= 2024 year))
      (is (= 1 (count month-groups)))
      (is (= 6 (first (first month-groups)))))))

(deftest grouping-tag-years
  (let [a1 (article {:title "newest" :year 2024 :timestamp 3})
        a2 (article {:title "middle" :year 2024 :timestamp 2})
        a3 (article {:title "oldest" :year 2023 :timestamp 1})
        [tag years] (gen/tag-articles ["clojure" [a1 a2 a3]])]
    (is (= "clojure" tag))
    (is (= [2024 2023] (mapv :year years)))
    (is (= ["newest" "middle"] (mapv :title (:articles (first years)))))
    (is (= ["oldest"] (mapv :title (:articles (second years)))))))

(defn- token-file-names [tokens]
  (mapv :file/name (map #(%) tokens)))

(deftest tag-tokens-render-category-pages
  (let [a1 (article {:title "Hello world" :tags ["clojure" "weblog"] :timestamp 20})
        a2 (article {:title "Texy port" :tags ["texy"] :timestamp 10})
        tokens (gen/tag-tokens {:articles [a1 a2] :config base-config})
        pages (into {} (map (fn [token]
                              (let [{:file/keys [name] :as file} (token)]
                                [name (:file/content file)]))
                            tokens))]
    (is (= ["tag/clojure.html" "tag/texy.html" "tag/weblog.html"]
           (sort (token-file-names tokens))))
    (is (string/includes? (get pages "tag/clojure.html") "Hello world"))
    (is (string/includes? (get pages "tag/weblog.html") "Hello world"))
    (is (string/includes? (get pages "tag/texy.html") "Texy port"))
    (is (string/includes? (get pages "tag/clojure.html") "Tag clojure"))
    (is (not (string/includes? (get pages "tag/texy.html") "Hello world")))))

(deftest time-tokens-render-index-pages
  (let [a1 (article {:title "Hello world" :year 2024 :month 5 :day 10 :timestamp 20})
        a2 (article {:title "Texy port" :year 2024 :month 6 :day 1 :timestamp 10})
        tokens (gen/time-tokens {:articles [a1 a2] :config base-config})
        pages (into {} (map (fn [token]
                              (let [{:file/keys [name] :as file} (token)]
                                [name (:file/content file)]))
                            tokens))]
    (is (= ["2024/05/10/index.html" "2024/05/index.html"
            "2024/06/01/index.html" "2024/06/index.html" "2024/index.html"]
           (sort (token-file-names tokens))))
    (is (string/includes? (get pages "2024/index.html") "Hello world"))
    (is (string/includes? (get pages "2024/index.html") "Texy port"))
    (is (string/includes? (get pages "2024/05/index.html") "Hello world"))
    (is (not (string/includes? (get pages "2024/05/index.html") "Texy port")))
    (is (string/includes? (get pages "2024/06/01/index.html") "Texy port"))))

;;-------------------------------------------------- singleton generators

(deftest theme-resolution
  (is (identical? test-theme/theme (gen/theme base-config))))

(deftest writing-files
  (let [dist (io/file *tmp* "dist")]
    (gen/write-file dist {:file/name "a.txt" :file/content "hello"})
    (is (= "hello" (slurp (io/file dist "a.txt"))))
    (gen/write-file dist {:file/name "a.txt" :file/content "!" :file/append true})
    (is (= "hello!" (slurp (io/file dist "a.txt"))))
    (gen/write-file dist {:file/name "b.txt" :file/dir "x/y" :file/content "deep"})
    (is (= "deep" (slurp (io/file dist "x" "y" "b.txt"))))
    (spit (io/file dist "c.txt") "old")
    (gen/write-file dist {:file/name "c.txt" :file/content "new" :file/preppend true})
    (is (= "new\nold" (slurp (io/file dist "c.txt"))))))

(deftest og-image-cards
  (let [a1 (article {:title "Hello world" :author-handle "rarous"
                     :card-image "https://example.com/weblog/2024/05/10/hello-world.png"})
        a2 (article {:title "Texy port" :author-handle "rarous"
                     :card-image "https://example.com/weblog/2024/06/01/texy-port.png"})
        [file] (gen/og-images {:articles [a1 a2] :config base-config})]
    (is (= "cards.json" (:file/name file)))
    (is (= ".." (:file/dir file)))
    (let [data (json/read-value (:file/content file) json/keyword-keys-object-mapper)]
      (is (= 2 (count data)))
      (is (= #{"Hello world" "Texy port"} (set (map :title data))))
      (is (= #{"rarous"} (set (map :name data))))
      (is (every? #(re-matches #"[0-9a-f]{64}" (:hash %)) data))
      (is (every? #(string/ends-with? (:url %) ".png") data)))))

(deftest og-image-cards-config
  (let [config (-> base-config
                   (assoc-in [:cards :file] "og-cards.json")
                   (assoc-in [:cards :dir] "assets"))
        [file] (gen/og-images {:articles [(article {:title "Hello world"})]
                               :config config})]
    (is (= "og-cards.json" (:file/name file)))
    (is (= "assets" (:file/dir file)))))

(deftest sitemap-generation
  (let [[file] (gen/sitemap
                 {:config base-config
                  :articles [(article {:title "Hello world"
                                       :file-name "2024/05/10/hello-world.html"
                                       :permalink "https://example.com/weblog/2024/05/10/hello-world.html"})]})]
    (is (= "sitemap.xml" (:file/name file)))
    (is (= "weblog" (:file/dir file)))
    (let [content (:file/content file)]
      (is (= 2 (count (re-seq #"<loc>" content))))
      (is (string/includes? content "https://example.com/weblog/"))
      (is (string/includes? content "https://example.com/weblog/2024/05/10/hello-world.html")))))

(deftest rss-generation
  (let [older (article {:title "Older post" :timestamp 10
                        :permalink "https://example.com/weblog/2024/05/10/older.html"})
        newer (article {:title "Newer post" :timestamp 20 :tags ["clojure"]
                        :permalink "https://example.com/weblog/2024/06/01/newer.html"})
        [file] (gen/articles-rss {:config base-config :articles [older newer]})
        content (:file/content file)]
    (is (= "articles.rss" (:file/name file)))
    (is (string/includes? content "Test feed"))
    (is (= 2 (count (re-seq #"<item" content))))
    (is (string/includes? content "https://example.com/weblog/2024/06/01/newer.html"))
    (is (string/includes? content "clojure"))
    (is (< (string/index-of content "Newer post")
           (string/index-of content "Older post")))))

(deftest rss-limit-and-file-config
  (let [older (article {:title "Older post" :timestamp 10 :permalink "https://example.com/old.html"})
        newer (article {:title "Newer post" :timestamp 20 :permalink "https://example.com/new.html"})
        config (assoc-in base-config [:rss :file] "feed.xml")
        [file] (gen/articles-rss
                 {:config (assoc-in config [:rss :limit] 1)
                  :articles [older newer]})
        content (:file/content file)]
    (is (= "feed.xml" (:file/name file)))
    (is (= 1 (count (re-seq #"<item" content))))
    (is (string/includes? content "Newer post"))
    (is (not (string/includes? content "Older post")))))

(deftest redirects-generation
  (let [a1 (article {:id "202405100"
                     :file-name "2024/05/10/hello-world.html"
                     :rel-link "/weblog/2024/05/10/hello-world.html"})
        a2 (article {:id "202406010"
                     :file-name "2024/06/01/texy-port.html"
                     :rel-link "/weblog/2024/06/01/texy-port.html"})
        a3 (article {:file-name "2024/06/02/no-id.html"
                     :rel-link "/weblog/2024/06/02/no-id.html"})
        [file] (gen/redirects {:articles [a1 a2 a3] :config base-config})]
    (is (= "_redirects" (:file/name file)))
    (is (:file/preppend file))
    (is (= "/weblog/202405100-hello-world.aspx /weblog/2024/05/10/hello-world.html 301\n"
           (string/replace (:file/content file)
                           #"/weblog/202406010-texy-port\.aspx /weblog/2024/06/01/texy-port\.html 301\n"
                           ""))
        (:file/content file))
    (is (string/includes? (:file/content file)
                          "/weblog/202406010-texy-port.aspx /weblog/2024/06/01/texy-port.html 301\n"))
    (is (not (string/includes? (:file/content file) "no-id")))))

;;-------------------------------------------------- the whole pipeline

(defn build-site! [root]
  (let [content (io/file root "content" "weblog")]
    (.mkdirs content)
    (spit (io/file content "2024-05-10-hello-world.texy")
          (front-matter {:title "Hello world" :published "2024-05-10T10:00:00.000Z"
                         :author "Ales R" :tags ["clojure" "weblog"] :id "202405100"}
                        "**Hello** world"))
    (spit (io/file content "2024-06-01-texy-port.texy")
          (front-matter {:title "Texy port" :published "2024-06-01T09:00:00.000Z"
                         :author "Ales R" :tags ["texy"] :id "202406010"}
                        "Texy is a text to HTML converter"))
    (.mkdirs (io/file root ".gryphoon" "dist"))
    (spit (io/file root ".gryphoon" "dist" "_redirects") "# manual rules\n")))

(deftest full-generation-run
  (let [site (io/file *tmp* "site")
        dist (io/file site ".gryphoon" "dist")
        read (fn [& rel] (slurp (apply io/file dist rel)))]
    (build-site! site)
    (gen/run base-config site)
    (testing "article pages"
      (let [hello (read "weblog" "2024" "05" "10" "hello-world.html")]
        (is (string/includes? hello "<h1>Hello world</h1>"))
        (is (string/includes? hello "<strong>Hello</strong> world")))
      (let [texy (read "weblog" "2024" "06" "01" "texy-port.html")]
        (is (string/includes? texy "<h1>Texy port</h1>"))))
    (testing "index page, latest first"
      (let [index (read "weblog" "index.html")]
        (is (< (string/index-of index "Texy port") (string/index-of index "Hello world")))))
    (testing "tag pages"
      (let [clojure (read "weblog" "tag" "clojure.html")]
        (is (string/includes? clojure "Hello world"))
        (is (not (string/includes? clojure "Texy port"))))
      (is (string/includes? (read "weblog" "tag" "texy.html") "Texy port")))
    (testing "time index pages"
      (is (string/includes? (read "weblog" "2024" "index.html") "Hello world"))
      (let [may (read "weblog" "2024" "05" "index.html")]
        (is (string/includes? may "Hello world"))
        (is (not (string/includes? may "Texy port"))))
      (is (string/includes? (read "weblog" "2024" "06" "01" "index.html") "Texy port")))
    (testing "syndication feed page"
      (let [feed (read "weblog" "feed" "index.html")]
        (is (string/includes? feed "Hello world"))
        (is (string/includes? feed "Texy port"))))
    (testing "RSS, sitemap, cards"
      (let [rss (read "weblog" "articles.rss")
            sitemap (read "weblog" "sitemap.xml")
            cards (json/read-value
                    (slurp (io/file site ".gryphoon" "cards.json"))
                    json/keyword-keys-object-mapper)]
        (is (= 2 (count (re-seq #"<item" rss))))
        (is (< (string/index-of rss "Texy port") (string/index-of rss "Hello world")))
        (is (string/includes? sitemap "https://example.com/weblog/2024/06/01/texy-port.html"))
        (is (= 3 (count (re-seq #"<loc>" sitemap))))
        (is (= #{"Hello world" "Texy port"} (set (map :title cards))))))
    (testing "legacy redirects are prepended to the existing file"
      (let [redirects (read "_redirects")]
        (is (= 2 (count (re-seq #" 301\n" redirects))))
        (is (string/includes? redirects
                              "/weblog/202405100-hello-world.aspx /weblog/2024/05/10/hello-world.html 301\n"))
        (is (string/includes? redirects
                              "/weblog/202406010-texy-port.aspx /weblog/2024/06/01/texy-port.html 301\n"))
        (is (string/ends-with? redirects "# manual rules\n"))))))

(defn -main [& _]
  (require 'work.gryphoon.weblog.generator-test)
  (let [{:keys [fail error]} (t/run-tests 'work.gryphoon.weblog.generator-test)]
    (System/exit (if (zero? (+ fail error)) 0 1))))
