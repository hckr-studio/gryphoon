(ns work.gryphoon.texy.wellformer-test
  "Unit tests for the WellFormer formatting port (work.gryphoon.texy.wellformer):
  block indentation, blank lines between block siblings, line
  wrapping, preserved spaces, and the PHP-compatible wordwrap.

  The wordwrap corpus (fixtures/wordwrap-corpus.json, 4374 cases)
  was captured from PHP wordwrap() by the Node.js sibling's
  tools/wordwrap-oracle.php - every case must replay exactly. The
  serialization tests were verified against the reference
  WellFormer's output on the render-full fixtures (see
  work.gryphoon.texy.conformance-test, the formatted suite)."
  (:require [clojure.data.json :as json]
            [clojure.test :refer [deftest is testing]]
            [huff2.core :as huff]
            [work.gryphoon.texy.wellformer :as wf]))

(def ^:private corpus
  (json/read-str (slurp "../texy-fixtures/wordwrap-corpus.json")))

(deftest wordwrap-corpus-replay
  (is (= 4374 (count corpus)) "the whole corpus must be replayed")
  (doseq [{:strs [input width break expected]} corpus]
    (is (= expected (wf/wordwrap input width break))
        (pr-str {:input input :width width :break break}))))

(deftest block-indentation
  (testing "block elements indent with tabs, blank line between siblings"
    (is (= "<p>x</p>\n\n<p>y</p>\n"
           (wf/serialize [[:p "x"] [:p "y"]])))
    (is (= "<div>\n\t<p>x</p>\n</div>\n"
           (wf/serialize [[:div [:p "x"]]])))
    (testing "adjacent closes do not get a blank line"
      (is (= "<div><p>x</p></div>"
             (wf/serialize [[:div [:p "x"]]] {:line-wrap 0 :indent false})))))
  (testing "inline elements stay on the block's line"
    (is (= "<p>a <strong>b</strong> c</p>\n"
           (wf/serialize [[:p "a " [:strong "b"] " c"]])))))

(deftest void-elements
  (testing "<br> ends the line (the eat-spaces mode eats what follows)"
    (is (= "<p>one<br>\ntwo</p>\n"
           (wf/serialize [[:p "one" [:br] " two"]] {:line-wrap 0}))))
  (testing "consecutive block voids collapse their soft newlines"
    (is (= "<hr>\n<hr>\n"
           (wf/serialize [[:hr] [:hr]])))))

(deftest preserved-content
  (testing "pre/textarea/script/code keep whitespace verbatim"
    (is (= "<pre>a  b\n\tc</pre>\n"
           (wf/serialize [[:pre "a  b\n\tc"]] {:line-wrap 0})))
    (is (= "<p>a <code>x  y</code> b</p>\n"
           (wf/serialize [[:p "a " [:code "x  y"] " b"]] {:line-wrap 0}))))
  (testing "text runs shrink to single spaces outside them"
    (is (= "<p>a b</p>\n"
           (wf/serialize [[:p "a " "  b"]] {:line-wrap 0})))))

(deftest line-wrapping
  (testing "a long paragraph wraps at the width, tabs repeated on continuations"
    (is (= "<p>aaa\nbbb</p>\n"
           (wf/serialize [[:p "aaa bbb"]] {:line-wrap 5})))
    (is (= "<div>\n\t<p>aaa\n\tbbb</p>\n</div>\n"
           (wf/serialize [[:div [:p "aaa bbb"]]] {:line-wrap 5}))))
  (testing "wrapping never breaks inside an attribute value (frozen spaces)"
    (is (= "<p><img\nsrc=\"a b c\"\nalt=\"\">x</p>\n"
           (wf/serialize [[:p [:img {:src "a b c" :alt ""}] "x"]] {:line-wrap 10})))))

(deftest fragments
  (testing "children join through ONE formatter, separated by text newlines"
    (is (= "<p>a</p> <p>b</p>"
           (wf/serialize-fragment [[[:p "a"]] [[:p "b"]]] {:line-wrap 0 :indent false}))))
  (testing "the result is trimmed at both ends"
    (is (= "<p>x</p>"
           (wf/serialize-fragment [[[:p "x"]]] {:line-wrap 0})))))

(deftest raw-tokenization
  (testing "raw comments are preserved verbatim, never wrapped inside"
    (is (= "<p>a<!-- c -->b</p>\n"
           (wf/serialize [[:p "a" (huff/raw "<!-- c -->") "b"]] {:line-wrap 0}))))
  (testing "raw tags take part in the stack (unclosed ones close at finish)"
    (is (= "<b>x</b>"
           (wf/serialize-fragment [[(huff/raw "<b>x")]] {:line-wrap 0 :indent false})))))
