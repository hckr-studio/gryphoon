(ns work.gryphoon.texy.comment-setup-test
  "The translation of a Texy 3 comment-setup configuration:

    Configurator::safeMode, the phrase allowed flags, allowedTags = false,
    headingModule->top = 4 and linkModule->addReference

  Expected value verified against the PHP reference with the identical
  configuration and the DEFAULT output formatting (indented, wrapped
  at 80 - this port's new default since the WellFormer formatting
  landed); the user references land with the same gap semantics:
  linkless entries leave holes in the numbering and an unresolved
  reference falls back to its name."
  (:require [clojure.test :refer [deftest is testing]]
            [work.gryphoon.texy.core :as core]))

(defn comment-texy []
  (as-> (core/->texy {:top 4}) texy
    (core/safe-mode texy)
    ;; Texy 3 allowed['phrase/...']: ins/del/sup/sub are opt-in, like
    ;; the reference allowed[] defaults (the engine drops a disabled
    ;; syntax); 'phrase/cite' has no Texy 4 equivalent
    (assoc-in texy [:options :allowed]
              (merge (get-in texy [:options :allowed])
                     {"phrase/ins" true "phrase/del" true
                      "phrase/sup" true "phrase/sub" true}))
    ;; allowedTags = false
    (assoc-in texy [:options :allowed-tags] false)
    ;; linkModule->addReference: a user-defined link definition,
    ;; persisted across process calls; the Texy 3 Link label/modifier
    ;; carriers live in the 5-arity add-definition (applied with
    ;; :legacy-references, see work.gryphoon.texy.references-test)
    (core/add-definition texy "1" "https://example.com/comment-1#comment")
    (core/add-definition texy "3" "https://example.com/comment-3#comment")))

(deftest texy3-comment-setup
  (testing "safe mode, enabled phrases, top 4 headings, user references"
    (is (= (str "<p><ins>ins</ins> <del>del</del> sup<sup>2</sup> sub<sub>2</sub>_ \u201Enice\u201C</p>\n\n"
                "<p>&lt;script&gt;alert(1)&lt;/scrip\u00ADt&gt; x</p>\n\n"
                "<h4>Title</h4>\n\n"
                "<p>see <a href=\"https://example.com/comment-1#comment\"\n"
                "rel=\"nofollow\">comment</a>"
                " and <a href=\"https://example.com/comment-3#comment\"\n"
                "rel=\"nofollow\">other</a>"
                " and <a href=\"2\">gap</a></p>\n")
           (core/process (comment-texy)
                         "++ins++ --del-- sup^2 sub_2_ \"nice\" .[btn]\n\n<script>alert(1)</script> x\n\nTitle\n=====\n\nsee \"comment\":[1] and \"other\":[3] and \"gap\":[2]")))))

(deftest default-phrase-gating
  (testing "ins/del/sup/sub are opt-in like the reference allowed[] defaults
            (typography off so the literal delimiters stay untouched)"
    (is (= "<p>++x++ --y-- ^^z^^ __w__</p>"
           (core/process (core/->texy {:typography false :indent false :line-wrap 0}) "++x++ --y-- ^^z^^ __w__")))
    (is (= "<p><ins>x</ins> <del>y</del> <sup>z</sup> <sub>w</sub></p>"
           (core/process (core/->texy {:typography false :indent false :line-wrap 0
                                       :allowed {"phrase/ins" true "phrase/del" true
                                                 "phrase/sup" true "phrase/sub" true}})
                         "++x++ --y-- ^^z^^ __w__")))))
