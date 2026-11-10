package work.gryphoon.texy

import com.intellij.psi.tree.IElementType

/**
 * Lexer smoke: tokenizes a representative document and checks
 * (1) exact tiling of the buffer, (2) expected token classifications,
 * (3) state transitions for blocks, fences and the front matter.
 */
object LexerSmoke {

    fun tokens(text: String): List<Pair<String, String>> {
        val lexer = TexyLexer()
        lexer.start(text, 0, text.length, 0)
        val result = mutableListOf<Pair<String, String>>()
        while (lexer.tokenType != null) {
            val type = lexer.tokenType!!
            result += type.toString() to text.substring(lexer.tokenStart, lexer.tokenEnd)
            lexer.advance()
        }
        return result
    }

    fun check() {
        val doc = """
            |---
            |title: Hello
            |---
            |## Heading
            |- list item
            |> quote line
            |"link":http://example.com [*img.jpg*] .(title)[cls]{style} {{youtube(x)}}
            |bacon &amp; <b>bold</b> **strong** *em* //italic//
            |/--code js .(title)
            |var x = 1;
            |\--
            |```clojure
            |(def x 1)
            |```
            |Text after.
        """.trimMargin() + "\n"

        val toks = tokens(doc)
        println(toks.joinToString("\n") { "[${it.second.length}] ${it.first}: ${it.second}" })

        // 1) exact tiling
        var expected = 0
        val lexer = TexyLexer()
        lexer.start(doc, 0, doc.length, 0)
        while (lexer.tokenType != null) {
            check(lexer.tokenStart == expected) { "tile gap: expected start $expected, got ${lexer.tokenStart}" }
            check(lexer.tokenEnd > lexer.tokenStart) { "zero-length token at ${lexer.tokenStart} (${lexer.tokenType})" }
            expected = lexer.tokenEnd
            lexer.advance()
        }
        check(expected == doc.length) { "coverage: $expected != ${doc.length}" }

        val names = toks.map { it.first }
        val texts = toks.map { it.second }

        // 2) expected classifications
        fun has(type: String, content: String) =
            toks.any { it.first == "TEXY_$type" && it.second.trim('\n') == content }
        check(has("FM_OPEN", "---")) { "front matter open" }
        check(has("FM", "title: Hello")) { "front matter host" }
        check(has("FM_CLOSE", "---")) { "front matter close" }
        check(has("MARK_HEADING", "## ")) { "hash heading" }
        check(has("MARK_LIST", "- ")) { "list marker" }
        check(has("MARK_QUOTE", "> ")) { "quote marker" }
        check(has("LINK", "\"link\":http://example.com")) { "link" }
        check(has("IMAGE", "[*img.jpg*]")) { "image" }
        check(has("DIRECTIVE", "{{youtube(x)}}")) { "directive" }
        check(has("ENTITY", "&amp;")) { "entity" }
        check(has("HTML_TAG", "<b>")) { "html tag" }
        check(has("MARK_PHRASE", "**")) { "phrase mark" }
        check(has("BLOCK_OPEN", "/--code js .(title)")) { "block open" }
        check(has("BLOCK_CODE", "var x = 1;")) { "block code" }
        check(has("BLOCK_CLOSE", "\\--")) { "block close" }
        check(has("BLOCK_OPEN", "```clojure")) { "gfm open" }
        check(has("BLOCK_CODE", "(def x 1)")) { "gfm code" }
        check(has("BLOCK_CLOSE", "```")) { "gfm close" }
        check(has("MODIFIER", ".(title)")) { "modifier" }

        // 3) EDN front matter
        val ednDoc = "---\n{:author \"Aleš\" :tags #{:web}}\n---\ntext\n"
        val ednToks = tokens(ednDoc)
        check(ednToks.any { it.first == "TEXY_FM" && it.second.trim('\n').startsWith("{:") }) { "edn front matter" }

        println("ALL CHECKS PASSED")
    }

    private fun check(condition: Boolean, message: () -> String) {
        if (!condition) {
            throw AssertionError(message())
        }
    }
}

fun main() {
    LexerSmoke.check()
}
