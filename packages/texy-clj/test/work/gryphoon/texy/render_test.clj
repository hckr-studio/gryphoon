(ns work.gryphoon.texy.render-test
  "Rendering to hiccup vectors and the serialized HTML string. Display
  text must be escaped; hiccup serializes attribute values."
  (:require [clojure.test :refer [deftest is testing]]
            [work.gryphoon.texy.core :as core]))

(defn html
  ([text] (html text {}))
  ([text opts]
   (core/process (core/->texy opts) text {:indent false :line-wrap 0})))
;;-------------------------------------------------- blocks

(deftest paragraphs
  (is (= "<p>Plain</p>" (html "Plain")))
  (testing "hard break from an indented continuation"
    (is (= "<p>one<br>two</p>" (html "one\n  two"))))
  (testing "modifier attributes"
    (is (= "<p title=\"T\" class=\"a\">text</p>" (html "text .(T)[a]")))))

(deftest headings
  (testing "underlined heading balanced to the top level"
    (is (= "<h1>Title</h1>" (html "Title\n===="))))
  (testing "surrounded heading with modifier"
    (is (= "<h1 style=\"color:red\">Title</h1>"
           (html "## Title .{color:red}")))))

(deftest lists
  (testing "unordered"
    (is (= "<ul><li>one</li><li>two</li></ul>" (html "- one\n- two"))))
  (testing "ordered with start"
    (is (= "<ol start=\"13\"><li>one</li><li>two</li></ol>"
           (html "13) one\n14) two"))))
  (testing "roman/alpha lists carry a list-style-type"
    (is (= "<ol style=\"list-style-type:upper-roman\"><li>one</li><li>two</li></ol>"
           (html "I. one\nII. two"))))
  (testing "nested: the opening plain paragraph is spliced into the item"
    (is (= "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>"
           (html "- one\n- two\n  - nested"))))
  (testing "definition list"
    (is (= "<dl><dt>Chicken</dt><dd>flightless bird</dd></dl>"
           (html "Chicken:\n  - flightless bird")))))

(deftest blockquotes
  (is (= "<blockquote><p>quoted</p></blockquote>" (html "> quoted")))
  (is (= "<blockquote><blockquote><p>inner</p></blockquote></blockquote>"
         (html "> > inner"))))

(deftest horizontal-rules
  (is (= "<hr>" (html "---"))))

(deftest code-blocks
  (is (= "<pre class=\"language-clojure\"><code>(def x 1)</code></pre>"
         (html "```clojure\n(def x 1)\n```"))))

;;-------------------------------------------------- inline

(deftest phrases
  (is (= "<p>a <strong>b</strong> c</p>" (html "a **b** c")))
  (is (= "<p>a <em>b</em> c</p>" (html "a //b// c")))
  (is (= "<p>a <strong><em>b</em></strong> c</p>" (html "a ***b*** c")))
  (is (= "<p>a <code>b</code> c</p>" (html "a `b` c")))
  (is (= "<p>m<sup>2</sup></p>" (html "m^2")))
  (is (= "<p>H<sub>2</sub> O</p>" (html "H_2 O")))
  (is (= "<p><q>quoted</q></p>" (html ">>quoted<<")))
  (testing "notexy is literal, escaped text"
    (is (= "<p>&lt;b&gt;raw&lt;/b&gt;</p>" (html "''<b>raw</b>''")))))

(deftest links
  (is (= "<p><a href=\"https://example.com\">check</a></p>"
         (html "\"check\":https://example.com")))
  (is (= "<p>see <a href=\"https://example.com\">text</a></p>"
         (html "see [text](https://example.com)")))
  (testing "www links gain the http scheme"
    (is (= "<p><a href=\"http://www.example.com\">www.example.com</a></p>"
           (html "www.example.com"))))
  (testing "image links resolve their [*img*] target"
    (is (= "<p>look <a href=\"popup.jpg\"><img src=\"img.jpg\" alt=\"\"></a> here</p>"
           (html "look [* img.jpg *]:[* popup.jpg *] here")))))

(deftest images
  (testing "inline image within text stays in the paragraph"
    (is (= "<p>look <img src=\"img.jpg\" alt=\"\"> here</p>"
           (html "look [* img.jpg *] here"))))
  (testing "dimensions and alt from the title"
    (is (= "<p>x <img src=\"img.jpg\" alt=\"photo\" width=\"100\" height=\"200\"> y</p>"
           (html "x [* img.jpg 100x200 .(photo) *] y"))))

  (testing "custom image root"
    (is (= "<p>look <img src=\"assets/i.jpg\" alt=\"\"> here</p>"
           (html "look [* i.jpg *] here" {:image-root "assets"}))))

  (testing "custom {alt:...} and {title:...} attributes and the figure modifier class"
    (is (= "<figure class=\"foo\"><img title=\"T\" src=\"img.jpg\" alt=\"alt text\"></figure>"
           (html "[* img.jpg .{alt:alt text; title:T} *] .[foo]"))))

  (testing "a lone image line is a figure, two images on one line is a paragraph"
    (is (= "<figure><img src=\"img.jpg\" alt=\"\"></figure>"
           (html "[* img.jpg *]")))
    (is (= "<div><img src=\"img.jpg\" alt=\"\"> <img src=\"img2.jpg\" alt=\"\"></div>"
           (html "[* img.jpg *] [* img2.jpg *]")))
    (is (= "<p>text <img src=\"img.jpg\" alt=\"\"> <img src=\"img2.jpg\" alt=\"\"></p>"
           (html "text [* img.jpg *] [* img2.jpg *]"))))

  (testing "the relative-URL check looks at the URL start only (query strings stay relative)"
    (is (= "<figure><a href=\"popup.php?img=big.jpg\"><img src=\"img.jpg\" alt=\"\"></a></figure>"
           (html "[* img.jpg *]:[* popup.php?img=big.jpg *]")))))

(deftest figures
  (testing "a lone image line renders as a figure"
    (is (= "<figure><img src=\"img.jpg\" alt=\"\"></figure>"
           (html "[* img.jpg *]"))))
  (testing "figure with caption"
    (is (= "<figure><img src=\"img.jpg\" alt=\"\"><figcaption>the caption</figcaption></figure>"
           (html "[* img.jpg *] *** the caption")))))

(deftest autolinks
  (is (= "<p><a href=\"https://example.com\">https://example.com</a></p>"
         (html "https://example.com")))
  (is (= "<p><a href=\"mailto:a&#64;b.cz\">a&#64;<!-- -->b.cz</a></p>" (html "a@b.cz"))))

;;-------------------------------------------------- escaping

(deftest escaping
  (testing "display text is escaped"
    (is (= "<p>a &lt; b &amp; c</p>" (html "a < b & c"))))
  (testing "attribute values are escaped"
    (is (= "<p title=\"a &amp; b &lt; c\">text</p>" (html "text .(a & b < c)")))))

(deftest entities
  (testing "the full HTML5 entity table decodes (jsoup, like the reference)"
    (is (= "<p>\u2021 \u25C2</p>" (html "&Dagger; &ltrif;"))))
  (testing "an unknown entity stays literal"
    (is (= "<p>&amp;unknownref;</p>" (html "&unknownref;"))))
  (testing "a NUL reference maps to U+FFFD"
    (is (= "<p>\uFFFD</p>" (html "&#0;"))))
  (testing "numeric references, hex and decimal; a lone A before a word is a
            preposition, typography binds it with nbsp (like the reference)"
    (is (= "<p>A B</p>" (html "&#65; &#x42;"))))
  (testing "tab decodes, refused controls stay literal (html_entity_decode semantics);
            typography turns the decoded tab into a space (postLine)"
    (is (= "<p>a b</p>" (html "a&#9;b")))
    (is (= "<p>a&amp;#13;b</p>" (html "a&#13;b")))
    (is (= "<p>a&amp;#127;b</p>" (html "a&#127;b")))
    ;; the cp1252-remap zone stays literal too (jsoup would remap it)
    (is (= "<p>a&amp;#128;b</p>" (html "a&#128;b"))))
  (testing "a control decode that strips to nothing renders as empty text"
    (is (= "<p>ab</p>" (html "a&#12;b")))))

(deftest rejected-passthrough-elements
  (testing "a rejected element's open and close tags both render as text - the
            reference HtmlSanitizePass runs on paired trees, so the AST pairing
            pass is not jsoup-replaceable (jsoup would drop the orphan close)"
    (is (= "<p>odkaz &lt;a&gt;test&lt;/a&gt; prázdný</p>"
           (html "odkaz <a>test</a> prázdný")))))


;;-------------------------------------------------- URL policy and e-mail URLs

(deftest url-policy
  (testing "by default every scheme passes (the reference's null patterns)"
    (is (= "<p><a href=\"javascript:x\">bad</a></p>" (html "\"bad\":javascript:x"))))
  (testing "the link pattern drops disallowed links to their content"
    (let [texy (core/->texy {:indent false :line-wrap 0 :link-pattern "https?:|ftp:|mailto:"})]
      (is (= "<p>bad</p>" (core/process texy "\"bad\":javascript:x")))
      (is (= "<p><a href=\"https://example.com\">ok</a></p>"
             (core/process texy "\"ok\":https://example.com")))))
  (testing "the image pattern renders a disallowed image as its alternative text"
    (let [texy (core/->texy {:indent false :line-wrap 0 :image-pattern "https?:"})]
      (is (= "<p>look here</p>"
             (core/process texy "look [* javascript:x *] here")))))
  (testing "URL attributes from modifiers pass the policy too"
    (let [texy (core/->texy {:indent false :line-wrap 0 :link-pattern "https?:"})]
      (is (= "<p>text</p>" (core/process texy "text .{href:javascript:x}")))))
  (testing "control characters inside a scheme are deleted before detection, like browsers do"
    (let [texy (core/->texy {:indent false :line-wrap 0 :typography false :hyphenation false
                              :link-pattern "https?:|ftp:|mailto:"})]
      ;; java\tscript: must not look scheme-less (relative) and slip through
      (is (= "<p>&lt;a href=\"java\tscript:alert(1)\"&gt;x&lt;/a&gt;</p>"
             (core/process texy "<a href=\"java\tscript:alert(1)\">x</a>")))
      (is (= "<p>&lt;a href=\"javascript:alert(1)\"&gt;x&lt;/a&gt;</p>"
             (core/process texy "<a href=\"jav\u0000ascript:alert(1)\">x</a>")))
      ;; \u0001 leading: browsers trim leading C0 controls before parsing
      (is (= "<p>&lt;a href=\"javascript:alert(1)\"&gt;x&lt;/a&gt;</p>"
             (core/process texy "<a href=\"\u0001javascript:alert(1)\">x</a>")))
      ;; a TAB elsewhere is harmless: the scheme survives cleaning or none existed
      (is (= "<a href=\"https://example.com/a\tb\">x</a>"
             (core/process texy "<a href=\"https://example.com/a\tb\">x</a>")))))

  (testing "e-mail link URLs gain the mailto: scheme"
    (is (= "<p><a href=\"mailto:john&#64;example.com\">mail me</a></p>"
           (html "\"mail me\":john@example.com")))
    (is (= "<p><a href=\"mailto:john&#64;example.com?subject=hi\">mail me</a></p>"
           (html "\"mail me\":john@example.com?subject=hi")))))

;;-------------------------------------------------- heading pass extras

(deftest heading-ids-and-toc
  (testing "the {toc: ...} style is hoisted off and never reaches the output"
    (is (= "<h1>Title</h1>" (html "Title .{toc: jiny toc}\n******"))))
  (testing "generated ids: webalized title, prefix, uniquification"
    (let [texy (core/->texy {:indent false :line-wrap 0 :generate-ids true})]
      (is (= "<h1 id=\"toc-title\">Title</h1><h2 id=\"toc-title-2\">Title</h2>"
             (core/process texy "Title\n******\n\nTitle\n======")))))
  (testing "an explicit modifier id wins"
    (let [texy (core/->texy {:indent false :line-wrap 0 :generate-ids true})]
      (is (= "<h1 id=\"x\">Title</h1>" (core/process texy "Title .[#x]\n******")))))
  (testing "heading slugs: accents removed by Unicode normalization, letters
            normalization cannot decompose mapped explicitly (oracle-verified)"
    (let [texy (core/->texy {:indent false :line-wrap 0 :generate-ids true})]
      (is (= "<h1 id=\"toc-souvisejici-clanky\">Související články</h1>"
             (core/process texy "Související články\n******")))
      (is (= "<h1 id=\"toc-tieng-viet\">Tiếng Việt</h1>"
             (core/process texy "Tiếng Việt\n******")))
      (is (= "<h1 id=\"toc-orsted\">Ørstěd</h1>"
             (core/process texy "Ørstěd\n******")))
      (is (= "<h1 id=\"toc-strasse\">Straße</h1>"
             (core/process texy "Straße\n******")))
      (is (= "<h1 id=\"toc-aero-skont\">Ærø skønt</h1>"
             (core/process texy "Ærø skønt\n******")))
      (is (= "<h1 id=\"toc-durdevic\">đurđević</h1>"
             (core/process texy "đurđević\n******")))
      (is (= "<h1 id=\"toc-thorr\">Þórr</h1>"
             (core/process texy "Þórr\n******"))))))

;;-------------------------------------------------- reference definitions

(deftest reference-definitions
  (testing "link definitions resolve [ref] URLs, keeping #fragment suffixes"
    (is (= "<p>see <a href=\"https://example.com/\">text</a></p>"
           (html "[ref]: https://example.com/\n\nsee \"text\":[ref]")))
    (is (= "<p>see <a href=\"https://example.com/#frag\">text</a></p>"
           (html "[ref]: https://example.com/\n\nsee \"text\":[ref#frag]"))))
  (testing "an unresolved reference becomes its own name"
    (is (= "<p>see <a href=\"nowhere\">text</a></p>" (html "see \"text\":[nowhere]"))))
  (testing "image definitions resolve the image and supply its alt"
    (is (= "<figure><img src=\"photo.png\" alt=\"alt text\"></figure>"
           (html "[*ref*]: photo.png .(alt text)\n\n[*ref*]"))))
  (testing "definition lines render to nothing"
    (is (= "<p>text</p>" (html "[ref]: https://example.com/\n\ntext")))))

;;-------------------------------------------------- emoticons

(deftest emoticons
  (testing "off by default: the emoticon stays literal"
    (is (= "<p>hi :-)</p>" (html "hi :-)"))))
  (testing "enabled: emoticons resolve to their emoji, boundaries respected"
    (let [texy (core/->texy {:indent false :line-wrap 0 :emoticons true})]
      (is (= "<p>hi 🙂</p>" (core/process texy "hi :-)")))
      (is (= "<p>hi 😛!</p>" (core/process texy "hi :-P!")))
      ;; a preceding word char fails the lookbehind: stays literal
      (is (= "<p>a:-)</p>" (core/process texy "a:-)")))
      ;; not at a word boundary stays literal
      (is (= "<p>word:-) stays</p>" (core/process texy "word:-) stays"))))))

;;-------------------------------------------------- plain text and single-line

(deftest plain-text
  (testing "blocks separate by blank lines, tags drop, content stays"
    (is (= "Heading\n\nSome strong text.\n\none\ntwo\n"
           (core/to-text (core/->texy {:indent false :line-wrap 0})
                         "Heading\n======\n\nSome <b>**strong**</b> text.\n\n- one\n- two")))
    (is (= "a\n\nb c\n"
           (core/to-text (core/->texy {:indent false :line-wrap 0}) "a\n\nb\nc"))))
  (testing "table rows join cells with tabs"
    (is (= "A\tB\n1\t2\n"
           (core/to-text (core/->texy {:indent false :line-wrap 0}) "| A | B\n| 1 | 2\n")))))

(deftest single-line
  (testing ":single-line parses one inline line, no block structure"
    (is (= "one <strong>two</strong> three"
           (core/process (core/->texy {:indent false :line-wrap 0}) "one **two** three" {:single-line true :indent false :line-wrap 0})))
    (is (= "<strong>two</strong>"
           (core/process (core/->texy {:indent false :line-wrap 0}) "**two**" {:single-line true :indent false :line-wrap 0})))))

;;-------------------------------------------------- URL shortening, nofollow and nesting repair

(deftest url-shortening
  (testing "long paths keep an ellipsis and the last 12 chars"
    (is (= "<p><a href=\"http://www.example.com/adresa/dlouha/moc.php\">www.example.com/…ouha/moc.php</a></p>"
           (html "www.example.com/adresa/dlouha/moc.php"))))
  (testing "a trailing ? is not part of the URL"
    (is (= "<p><a href=\"http://www.texy.info/path\">www.texy.info/path</a>?</p>"
           (html "www.texy.info/path?"))))
  (testing "a long fragment collapses to an ellipsis"
    (is (= "<p><a href=\"http://www.texy.info/path/#!/flag\">www.texy.info/path/#…</a></p>"
           (html "www.texy.info/path/#!/flag"))))
  (testing ":shorten-urls false keeps the full URL text"
    (is (= "<p><a href=\"http://www.texy.info/path\">www.texy.info/path</a>?</p>"
           (html "www.texy.info/path?" {:shorten-urls false})))))

(deftest nofollow
  (testing "the nofollow class moves onto rel"
    (is (= "<p><a href=\"http://phpfashion.com/\" rel=\"nofollow\">php Fashion</a></p>"
           (html "\"php Fashion .[nofollow]\":http://phpfashion.com/"))))
  (testing "it composes with other classes and stays case-sensitive"
    (is (= "<p><a class=\"test\" href=\"mailto:dave&#64;example.com\" rel=\"nofollow\">php Fashion</a></p>"
           (html "\"php Fashion .[nofollow test]\":mailto:dave@example.com")))
    (is (= "<p><a class=\"noFollow\" href=\"/trine/\">php Fashion</a></p>"
           (html "\"php Fashion .[noFollow]\":/trine/")))))

(deftest prohibited-nesting
  (testing "an autolink inside a link's content loses its tag, the text stays"
    (is (= "<p><a href=\"http://www.example.cz\">www.example.com/…ouha/moc.php</a></p>"
           (html "\"www.example.com/adresa/dlouha/moc.php\":www.example.cz")))))

;;-------------------------------------------------- blockquote, /--div and table edge cases

(deftest blockquote-continuations
  (testing "a bare > line continues the quote as an empty line"
    (is (= "<blockquote><p>one</p><p>two</p></blockquote>"
           (html "> one\n>\n> two")))))

(deftest nested-slash-divs
  (testing "an indented \\-- line is content, not a close; outdent keeps its backslash"
    (is (= "<div id=\"ok\"><p>auto</p><div id=\"menu\"><ul><li>x</li></ul><p>\\---</p><div id=\"m2\"><p>aa</p></div></div></div>"
           (html "/---div .[#ok]\nauto\n/---div .[#menu]\n  - x\n \\---\n/---div .[#m2]\naa\n\\---\n\\---")))))

(deftest table-cell-modifier
  (testing "a trailing cell modifier lands on the <td>"
    (is (= "<table><tbody><tr><td class=\"cell\">bunka</td><td>dve</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>"
           (html "| bunka .[cell] | dve\n| 1 | 2")))))

(deftest linked-image-self-reference
  (testing "the [*ref*]:: self-link resolves against the image definition"
    (is (= "<p>x <a href=\"texy.jpg\"><img src=\"texy.jpg\" alt=\"\" style=\"float:left\"></a> y</p>"
           (html "x [*obrazek3<]:: y\n\n[*obrazek3*]: texy.jpg")))))

(deftest locale-independence
  (testing "parsing is independent of the JVM default locale (the Turkish
            dotted-I: plain String.toLowerCase() would give tıtle/ımg)"
    (let [saved (java.util.Locale/getDefault)]
      (try
        (java.util.Locale/setDefault (java.util.Locale. "tr"))
        ;; tag names, attribute names and values lowercase ROOT-ly
        (is (= "<div><img src=\"x.gif\"></div>" (html "<IMG SRC=x.gif>")))
        ;; directive lookup is case-insensitive across locales
        (is (= "<p>H</p>"
               (core/process (core/add-directive (core/->texy {:indent false :line-wrap 0}) "hint"
                                                  (fn [_ _ _] {:type :text :text "H"}))
                             "{{HINT}}")))
        ;; mixed-case reference resolution
        (is (= "<p><a href=\"https://example.com/\">t</a></p>"
               (html "\"t\":[IMGREF]\n\n[imgref]: https://example.com/")))
        ;; webalized heading ids
        (is (= "<h1 id=\"toc-introduction\">Introduction</h1>"
               (html "Introduction\n==========" {:generate-ids true})))
        (finally
          (java.util.Locale/setDefault saved))))))

(deftest well-forming-direct-option
  (testing ":well-forming :direct selects the call-driven driver (to-html-direct)"
    (let [doc (core/parse (core/->texy) "a **b** and `code`\n\n> quote **x**")]
      (is (= (core/render-html doc {:well-forming :direct})
             (core/render-html doc))
          "the two paths are byte-identical on well-formed content")))
  (testing "the driver omits the implicit tbody jsoup inserts in passthrough tables"
    (let [doc (core/parse (core/->texy) "/--html\n<table><tr><td>x</td></tr></table>\n\\--")]
      (is (re-find #"tbody" (core/render-html doc))
          "the jsoup path (default) inserts it")
      (is (not (re-find #"tbody" (core/render-html doc {:well-forming :direct})))
          "the direct path does not"))))
