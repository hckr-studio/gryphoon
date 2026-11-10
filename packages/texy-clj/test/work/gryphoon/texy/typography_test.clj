(ns work.gryphoon.texy.typography-test
  "The typography module: locale quotes, dashes, ellipsis, non-breaking
  spaces, and the TextRunPass contract - markup is protected by the
  marker image, code and URLs are opaque, and disabled typography
  leaves the text alone. Expectations verified against the PHP
  reference."
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.data.json :as json]
            [work.gryphoon.texy.core :as core]
            [work.gryphoon.texy.typography :as typo]))

(defn html
  ([text] (html text {}))
  ([text opts]
   (core/process (core/->texy opts) text {:indent false :line-wrap 0})))

(deftest quotes-per-locale
  (testing "the default locale is cs (German-style low quotes)"
    (is (= "<p>He said \u201Ehello\u201C and \u201Aworld\u2018</p>"
           (html "He said \"hello\" and 'world'"))))
  (testing "fr: guillemets with the inner level in singleQuotes"
    (is (= "<p>He said \u00ABhello\u00BB and \u2039world\u203A</p>"
           (html "He said \"hello\" and 'world'" {:typography-locale "fr"}))))
  (testing "en: curly quotes"
    (is (= "<p>He said \u201Chello\u201D and \u2018world\u2019</p>"
           (html "He said \"hello\" and 'world'" {:typography-locale "en"}))))
  (testing "an unknown locale falls back to English, like the reference"
    (is (= "<p>He said \u201Chello\u201D</p>"
           (html "He said \"hello\"" {:typography-locale "xx"}))))
  (testing "the Node-port extras: Danish reversed guillemets, Finnish curly"
    (is (= "<p>He said \u00BBhello\u00AB and \u203Aworld\u2039</p>"
           (html "He said \"hello\" and 'world'" {:typography-locale "da"})))
    (is (= "<p>He said \u201Dhello\u201D and \u2019world\u2019</p>"
           (html "He said \"hello\" and 'world'" {:typography-locale "fi"})))))

(deftest dashes-ellipsis-dimensions
  (testing "en dash, em dash, ellipsis, dimension sign"
    (is (= "<p>a\u00A0\u2013 b \u2026 1978\u00A0\u2013 x</p>" (html "a -- b ... 1978 - x")))
    (is (= "<p>123\u00A0\u00D7\u00A0456</p>" (html "123 x 456")))))

(deftest protected-content
  (testing "code phrases are protected from typography"
    (is (= "<p>code <code>a--b</code> stays</p>" (html "code `a--b` stays"))))
  (testing "intermarkup space is removed before a comment marker"
    (is (= "<p>x<!-- c --> y</p>" (html "x <!-- c --> y"))))
  (testing "text between markup keeps its spaces"
    (is (= "<p><strong>b</strong> and <strong>c</strong></p>" (html "**b** and **c**")))))

(deftest nbsp-classes
  (testing "the number-nbsp class keeps % and letters as \\p{L} (covering all
            scripts, beyond the reference's legacy Letter ranges), extends
            the symbol blocks, and keeps punctuation like , outside"
    (is (= "<p>10\u00A0°C</p>" (html "10 °C")))
    (is (= "<p>123 , x</p>" (html "123 , x")))
    (is (= "<p>123\u00A0你好</p>" (html "123 你好")))))

(deftest disabled-typography
  (testing ":typography false leaves the text untouched"
    (is (= "<p>a -- b ...</p>" (html "a -- b ..." {:typography false})))))

(deftest apply-typography-api
  (testing "the reference applyTypography: normalize + typo, no parsing"
    (is (= "x\u00A0\u2013 y \u2026" (core/apply-typography (core/->texy) "x -- y ..."))))
  (testing "it honours the locale option and the typography flag"
    (is (= "\u00ABhi\u00BB" (core/apply-typography (core/->texy) "\"hi\"" {:locale "fr"})))
    (is (= "\"hi\"" (core/apply-typography (core/->texy {:typography false}) "\"hi\"")))))


;; The PHP-generated differential corpus (implementations/node.js/tools/
;; typo-probe.php: the reference TypographyModule::postLine, cs locale) -
;; the same oracle the Node port replays, so both typography catalogs are
;; pinned against the reference.
(def ^:private probe
  (json/read-str (slurp "fixtures/typo-probe.json")))

(deftest probe-corpus-coverage
  (is (= 49 (count probe)) "the whole corpus must be replayed"))

(deftest probe-corpus-replay
  (doseq [{:strs [input expected] :as entry} probe]
    ;; process-typo shrinks tabs and multi-spaces itself (the reference
    ;; postLine), so the raw input goes in directly
    (is (= expected (typo/process-typo input {:locale "cs"}))
        (pr-str entry))))
