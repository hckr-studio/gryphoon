(ns work.gryphoon.texy.references-test
  "The Texy 3 reference semantics (:legacy-references true), restored
  for historical documents: definitions carry a label and a modifier
  (the 4-dev reference deprecates and ignores them), reference URLs
  may contain %s, and image definitions' modifiers apply to [*img*]
  link targets. The bare [ref] syntax is opt-in (\"link/reference\"
  in :allowed, like the reference default).

  Expected values verified against the actual Texy 3.2.8 (the
  reference implementation of the semantics, extracted from this
  repo's git tags) with the identical inputs."
  (:require [clojure.test :refer [deftest is testing]]
            [work.gryphoon.texy.core :as core]))

(defn- texy3
  "A converter with both flags on: the bare [ref] syntax and the
  Texy 3 semantics. Flat output - these tests assert semantics, the
  formatting has its own oracle-verified suites."
  []
  (core/->texy {:legacy-references true
                :allowed {"link/reference" true}
                :indent false :line-wrap 0}))

(deftest definition-label
  (testing "the legacy flag alone enables the bare [ref] syntax (Texy 3 always allowed it)"
    (is (= "<p>use <a href=\"http://e.com/\">label</a></p>"
           (core/process (core/->texy {:legacy-references true :indent false :line-wrap 0})
                         "[l]: http://e.com/ label\n\nuse [l]"))))
  (testing "the label becomes the content of a bare [ref], inline parsed"
    (is (= "<p>use <a href=\"http://e.com/\"><strong>bold</strong> and <em>em</em></a></p>"
           (core/process (texy3) "[d]: http://e.com/ **bold** and *em*\n\nuse [d]"))))
  (testing "a label containing a reference resolves it (recursively; the nested <a> is suppressed)"
    (is (= "<p>use <a href=\"http://e.com/\">see inside</a></p>"
           (core/process (texy3) "[inner]: http://inner.com/ inside\n[a]: http://e.com/ see [inner]\n\nuse [a]"))))
  (testing "a circular label renders raw (the Texy 3 livelock)"
    (is (= "<p>start <a href=\"http://e.com/\">[x]</a> end</p>"
           (core/process (texy3) "[x]: http://e.com/ [x]\n\nstart [x] end"))))
  (testing "without a label a bare [ref] shows the shortened URL (the Texy 3 textualUrl)"
    (is (= "<p>go <a href=\"https://example.com/very-long-path/that/should-be/shortened\">https://example.com/…be/shortened</a> now</p>"
           (core/process (texy3) "[c]: https://example.com/very-long-path/that/should-be/shortened\n\ngo [c] now"))))
  (testing "the label is ignored for \"text\":[ref] uses (the display text lives at the use site)"
    (is (= "<p>go <a href=\"http://e.com/\">just-a-label</a> and <a href=\"http://e.com/\">x</a></p>"
           (core/process (texy3) "[l]: http://e.com/ just-a-label\n\ngo [l] and \"x\":[l]"))))
  (testing "an e-mail reference gains mailto: and shows its label"
    (is (= "<p>mail <a href=\"mailto:dave&#64;example.com\">David</a></p>"
           (core/process (texy3) "[me]: dave@example.com David\n\nmail [me]")))))

(deftest undefined-bare-reference
  (testing "an undefined bare [ref] stays literal text (Texy 3 without a newReference handler)"
    (is (= "<p>See [nowhere] text.</p>"
           (core/process (texy3) "See [nowhere] text."))))
  (testing "a defined bare [ref] still resolves"
    (is (= "<p>use <a href=\"http://e.com/\">name</a></p>"
           (core/process (texy3) "[d]: http://e.com/ name\n\nuse [d]"))))
  (testing "the labeled undefined form still falls back to the name as URL"
    (is (= "<p>see <a href=\"nowhere\">x</a></p>"
           (core/process (texy3) "see \"x\":[nowhere]"))))
  (testing "without :legacy-references the 4-dev behavior stays: the name becomes the URL"
    (is (= "<p>See <a href=\"nowhere\">nowhere</a> text.</p>"
           (core/process (core/->texy {:allowed {"link/reference" true} :indent false :line-wrap 0})
                         "See [nowhere] text.")))))

(deftest definition-modifier
  (testing "applies to every use site (bare and \"text\":[ref])"
    (let [expected (str "<p>go <a title=\"deftitle\" class=\"defcls\" style=\"color:red\" href=\"http://e.com/\">http://e.com/</a>"
                        " and <a title=\"deftitle\" class=\"defcls\" style=\"color:red\" href=\"http://e.com/\">text</a></p>")
          actual (core/process (texy3) "[m]: http://e.com/ .(deftitle)[defcls]{color:red}\n\ngo [m] and \"text\":[m]")]
      (is (= expected actual))))
  (testing "the use-site modifier wins on the title, classes union (definition first)"
    (is (= "<p><a title=\"usertitle\" class=\"defcls usercls\" href=\"http://example.org/\">text</a></p>"
           (core/process (texy3) "[b]: http://example.org/ .(deftitle)[defcls]\n\n\"text .(usertitle)[usercls]\":[b]"))))
  (testing "the image definition modifier applies to a [*img*] link target"
    (is (= (str "<p>click <a title=\"alt-title\" class=\"piccls\" href=\"http://e.com/pic.gif\">"
                "<img class=\"piccls\" src=\"http://e.com/pic.gif\" alt=\"alt-title\"></a></p>")
           (core/process (texy3) "[*img*]: http://e.com/pic.gif .(alt-title)[piccls]\n\nclick \"[*img*]\":[*img*]"))))
  (testing "by default (the flag off) the 4-dev behavior stays: modifiers are ignored"
    (let [texy (core/->texy {:allowed {"link/reference" true} :indent false :line-wrap 0})]
      (is (= "<p>go <a href=\"http://e.com/\">m</a> and <a href=\"http://e.com/\">text</a></p>"
             (core/process texy "[m]: http://e.com/ .(deftitle)[defcls]\n\ngo [m] and \"text\":[m]"))))))

(deftest percent-s-substitution
  (testing "takes the use-site text, form-url-encoded"
    (is (= "<p><a href=\"https://wiki.example.com/search?q=my+page\">my page</a></p>"
           (core/process (texy3) "[wiki]: https://wiki.example.com/search?q=%s\n\n\"my page\":[wiki]"))))
  (testing "encodes ! ' ( ) ~ which java.net.URLEncoder leaves"
    (is (= "<p><a href=\"http://e.com/a+b+%26+c/page\">a b &amp; c</a></p>"
           (core/process (texy3) "[w]: http://e.com/%s/page\n\n\"a b & c\":[w]"))))
  (testing "deliberately deviates from PHP urlencode on '*': a valid URL sub-delim, stays literal"
    (is (= "<p><a href=\"http://e.com/star+*+tip/page\">star * tip</a></p>"
           (core/process (texy3) "[w]: http://e.com/%s/page\n\n\"star * tip\":[w]"))))
  (testing "a bare [ref] keeps the %s literal (no use-site text exists)"
    (is (= "<p>go <a href=\"http://e.com/%s/page\">http://e.com/%s/page</a></p>"
           (core/process (texy3) "[w]: http://e.com/%s/page\n\ngo [w]")))))

(deftest add-definition-api
  (testing "accepts a label and a modifier (the Texy 3 Link::$label / Link::$modifier)"
    (let [texy (core/add-definition (texy3) "api" "https://example.com/api" "API **docs**" ".(The API)")]
      (is (= "<p>check <a title=\"The API\" href=\"https://example.com/api\">API <strong>docs</strong></a></p>"
             (core/process texy "check [api]")))))
  (testing "the plain 3-arity keeps working (no label: the textual URL shows)"
    (let [texy (core/add-definition (texy3) "plain" "https://example.com/plain")]
      (is (= "<p>see <a href=\"https://example.com/plain\">https://example.com/plain</a></p>"
             (core/process texy "see [plain]"))))))
