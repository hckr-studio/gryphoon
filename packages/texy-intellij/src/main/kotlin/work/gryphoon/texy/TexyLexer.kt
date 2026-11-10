package work.gryphoon.texy

import com.intellij.lexer.Lexer
import com.intellij.lexer.LexerPosition
import com.intellij.psi.tree.IElementType

/**
 * Line-oriented lexer for Texy documents.
 *
 * Two regions carry injected languages: code blocks (`/-- code js`, `/--php`,
 * GFM ``` fences; the injected language comes from the opening line) and
 * the front matter (a `---` section at the document start; yaml by default,
 * EDN when the section starts with `{:`). Everything else is tokenized for
 * highlighting: line markers (headings, lists, quotes, HR) and inline
 * syntaxes (links, images, references, modifiers, directives, HTML tags,
 * entities, phrase marks).
 *
 * Tokens tile the buffer exactly: the leading newline of a closing line
 * belongs to the closing token, the trailing newline of every ordinary
 * line to its last token. Blocks close at the first `\--` / closing fence
 * (nested blocks are not tracked in v1).
 */
class TexyLexer : Lexer() {

    private var buffer: CharSequence = ""
    private var bufferEnd = 0

    private var tokenStart = 0
    private var tokenEnd = 0
    private var token: IElementType? = null

    private val queue = ArrayDeque<Queued>()

    private var inCode = false
    private var inGfm = false
    private var fenceLength = 0
    private var inFrontMatter = false

    private class Queued(val type: IElementType, val start: Int, val end: Int)

    override fun start(buffer: CharSequence, startOffset: Int, endOffset: Int, initialState: Int) {
        this.buffer = buffer
        this.bufferEnd = endOffset
        this.inCode = initialState and STATE_CODE != 0
        this.inGfm = initialState and STATE_GFM != 0
        this.inFrontMatter = initialState and STATE_FM != 0
        this.fenceLength = 0
        this.token = null
        this.tokenEnd = startOffset
        this.queue.clear()
        advance()
    }

    override fun getState(): Int =
        (if (inCode) STATE_CODE else 0) or (if (inGfm) STATE_GFM else 0) or (if (inFrontMatter) STATE_FM else 0)

    override fun getTokenType(): IElementType? = token

    override fun getTokenStart(): Int = tokenStart

    override fun getTokenEnd(): Int = tokenEnd

    override fun advance() {
        while (queue.isEmpty() && tokenEnd < bufferEnd) {
            tokenStart = tokenEnd
            when {
                inFrontMatter -> lexFrontMatterContent()
                inCode -> lexBlockContent()
                else -> lexLine()
            }
        }
        val next = queue.removeFirstOrNull() ?: run {
            token = null
            return
        }
        emit(next.type, next.start, next.end)
    }

    override fun getCurrentPosition(): LexerPosition = object : LexerPosition {
        override fun getOffset() = tokenStart
        override fun getState() = this@TexyLexer.getState()
    }

    override fun restore(position: LexerPosition) {
        tokenEnd = position.offset
        val state = position.state
        inCode = state and STATE_CODE != 0
        inGfm = state and STATE_GFM != 0
        inFrontMatter = state and STATE_FM != 0
        fenceLength = 0
        token = null
        queue.clear()
        advance()
    }

    override fun getBufferSequence(): CharSequence = buffer

    override fun getBufferEnd(): Int = bufferEnd

    //----------------------------------------------------------------------------

    /** Front matter content up to the closing `---`, then the close line. */
    private fun lexFrontMatterContent() {
        var closeStart = findCloseLine(tokenStart) { it == "---" }
        val contentEnd = when {
            closeStart < 0 -> bufferEnd
            closeStart > tokenStart && buffer[closeStart - 1] == '\n' -> closeStart - 1
            else -> tokenStart
        }
        if (contentEnd > tokenStart) {
            queue.add(Queued(TexyTokenTypes.FRONT_MATTER, tokenStart, contentEnd))
        }
        if (closeStart < 0) {
            inFrontMatter = false
            return
        }
        val closeEnd = lineEndOf(closeStart) + 1
        val closeTokenStart = if (contentEnd < closeStart) contentEnd else closeStart
        queue.add(Queued(TexyTokenTypes.FRONT_MATTER_CLOSE, closeTokenStart, closeEnd))
        inFrontMatter = false
    }

    /** Block content up to the closing line, then the close line. */
    private fun lexBlockContent() {
        var closeStart = -1
        var pos = tokenStart
        while (pos < bufferEnd) {
            val closing = if (inGfm) isGfmClose(pos) else lineTrimmedAt(pos).startsWith("\\--")
            if (closing) {
                closeStart = pos
                break
            }
            pos = lineEndOf(pos) + 1
        }
        val contentEnd = when {
            closeStart < 0 -> bufferEnd
            closeStart > tokenStart && buffer[closeStart - 1] == '\n' -> closeStart - 1
            else -> tokenStart
        }
        if (contentEnd > tokenStart) {
            queue.add(Queued(TexyTokenTypes.CODE, tokenStart, contentEnd))
        }
        if (closeStart < 0) {
            inCode = false
            inGfm = false
            return
        }
        val closeEnd = lineEndOf(closeStart) + 1
        val closeTokenStart = if (contentEnd < closeStart) contentEnd else closeStart
        queue.add(Queued(TexyTokenTypes.CLOSE, closeTokenStart, closeEnd))
        inCode = false
        inGfm = false
    }

    /** One ordinary texy line: whole-line classification, or line marker + inline scan. */
    private fun lexLine() {
        val pos = tokenStart
        val lineEnd = lineEndOf(pos)
        val text = subLine(pos, lineEnd)

        // the front matter opens only at the very document start
        if (pos == 0 && text == "---") {
            queue.add(Queued(TexyTokenTypes.FRONT_MATTER_OPEN, pos, lineEnd + 1))
            inFrontMatter = true
            return
        }

        if (isTexyOpen(text)) {
            inCode = true
            inGfm = false
            fenceLength = 0
            queue.add(Queued(TexyTokenTypes.OPEN, pos, lineEnd + 1))
            return
        }
        val ticks = leadingBackticks(text)
        if (ticks >= 3) {
            inCode = true
            inGfm = true
            fenceLength = ticks
            queue.add(Queued(TexyTokenTypes.OPEN, pos, lineEnd + 1))
            return
        }

        when {
            RE_DECORATION.matches(text) ->
                queue.add(Queued(TexyTokenTypes.MARK_HEADING, pos, lineEnd + 1))
            else -> {
                val marker: Pair<IElementType, Int>? = when {
                    RE_HASH.containsMatchIn(text) ->
                        TexyTokenTypes.MARK_HEADING to RE_HASH.find(text)!!.value.length
                    RE_LIST.containsMatchIn(text) ->
                        TexyTokenTypes.MARK_LIST to RE_LIST_MARK.find(text)!!.value.length
                    RE_QUOTE.containsMatchIn(text) ->
                        TexyTokenTypes.MARK_QUOTE to RE_QUOTE.find(text)!!.value.length
                    else -> null
                }
                if (marker == null) {
                    pushInline(pos, lineEnd, null)
                } else {
                    val (type, length) = marker
                    queue.add(Queued(type, pos, pos + length))
                    pushInline(pos + length, lineEnd, null)
                }
            }
        }

        // the trailing newline belongs to the last token of the line
        val last = queue.removeLast()
        queue.addLast(Queued(last.type, last.start, lineEnd + 1))
    }

    //----------------------------------------------------------------------------

    /** Scans [from, to) with the inline patterns. */
    private fun pushInline(from: Int, to: Int, head: Pair<IElementType, Int>?) {
        if (head != null) {
            queue.add(Queued(head.first, from, from + head.second))
        }
        if (from >= to) {
            return
        }
        var i = from
        var plainStart = from
        while (i < to) {
            val match = matchInline(i, to)
            if (match == null) {
                i++
                continue
            }
            if (i > plainStart) {
                queue.add(Queued(TexyTokenTypes.PLAIN, plainStart, i))
            }
            queue.add(Queued(match.first, i, i + match.second))
            i += match.second
            plainStart = i
        }
        if (plainStart < to) {
            queue.add(Queued(TexyTokenTypes.PLAIN, plainStart, to))
        }
    }

    /** The inline pattern matching at [pos], or null: (type, length). */
    private fun matchInline(pos: Int, to: Int): Pair<IElementType, Int>? {
        val c = buffer[pos]
        val next = if (pos + 1 < bufferEnd) buffer[pos + 1] else ' '
        return when {
            c == '<' -> matchAt(pos, to, RE_HTML_TAG, TexyTokenTypes.HTML_TAG)
            c == '.' && next in "([{" -> matchAt(pos, to, RE_MODIFIER, TexyTokenTypes.MODIFIER)
            c == '{' && next == '{' -> matchAt(pos, to, RE_DIRECTIVE, TexyTokenTypes.DIRECTIVE)
            c == '"' -> matchAt(pos, to, RE_LINK, TexyTokenTypes.LINK)
            c == '[' -> matchAt(pos, to, RE_IMAGE, TexyTokenTypes.IMAGE)
                ?: matchAt(pos, to, RE_REFERENCE, TexyTokenTypes.REFERENCE)
            c == '&' -> matchAt(pos, to, RE_ENTITY, TexyTokenTypes.ENTITY)
            c == '*' -> matchAt(pos, to, RE_PHRASE_STAR, TexyTokenTypes.MARK_PHRASE)
            c == '/' && next == '/' -> TexyTokenTypes.MARK_PHRASE to 2
            c == '`' -> matchAt(pos, to, RE_PHRASE_TICK, TexyTokenTypes.MARK_PHRASE)
            else -> null
        }
    }

    private fun matchAt(pos: Int, to: Int, pattern: Regex, type: IElementType): Pair<IElementType, Int>? {
        // the patterns are ^-anchored against the line-bounded slice,
        // so a match begins at pos by construction
        val m = pattern.find(buffer.subSequence(pos, to)) ?: return null
        return type to m.value.length
    }

    //----------------------------------------------------------------------------

    private fun findCloseLine(from: Int, isClose: (String) -> Boolean): Int {
        var pos = from
        while (pos < bufferEnd) {
            if (isClose(subLine(pos, lineEndOf(pos)))) return pos
            pos = lineEndOf(pos) + 1
        }
        return -1
    }

    private fun lineEndOf(pos: Int): Int {
        var i = pos
        while (i < bufferEnd && buffer[i] != '\n') i++
        if (i > pos && buffer[i - 1] == '\r') i--
        return i
    }

    private fun subLine(start: Int, end: Int): String = buffer.subSequence(start, end).toString()

    private fun lineTrimmedAt(pos: Int): String = subLine(pos, lineEndOf(pos)).trimStart()

    private fun isTexyOpen(line: String): Boolean {
        val trimmed = line.trimStart()
        if (!trimmed.startsWith("/--")) return false
        val rest = trimmed.substring(3).trim()
        val type = rest.split(Regex("\\s+")).firstOrNull { it.isNotEmpty() } ?: return false
        val lowered = type.lowercase()
        if (lowered in NON_CODE_TYPES) return false
        if (lowered == "code" || lowered == "pre" || lowered == "html") return true
        return type.matches(RE_LANGUAGE_SHAPE)
    }

    private fun isGfmClose(pos: Int): Boolean {
        val line = subLine(pos, lineEndOf(pos))
        val m = RE_GFM_CLOSE.find(line) ?: return false
        return m.value.length >= fenceLength
    }

    private fun leadingBackticks(line: String): Int {
        var i = 0
        while (i < line.length && (line[i] == ' ' || line[i] == '\t')) i++
        var count = 0
        while (i < line.length && line[i] == '`') {
            count++
            i++
        }
        return count
    }

    private fun emit(type: IElementType, start: Int, end: Int) {
        token = type
        tokenStart = start
        tokenEnd = end
    }

    companion object {
        private const val STATE_CODE = 1
        private const val STATE_GFM = 2
        private const val STATE_FM = 4

        private val NON_CODE_TYPES = setOf("div", "text", "comment", "texy", "texysource", "notexy")

        private val RE_LANGUAGE_SHAPE = Regex("^[A-Za-z][A-Za-z0-9_+#.-]*$")

        private val RE_DECORATION = Regex("^(?:={3,}|-{3,}|\\*{3,})$")

        private val RE_HASH = Regex("^#{1,6}[ \\t]?")
        private val RE_LIST = Regex("^[ \\t]*(?:[-*+]|\\d{1,3}[.)])([ \\t]|$)")
        private val RE_LIST_MARK = Regex("^[ \\t]*(?:[-*+]|\\d{1,3}[.)])[ \\t]*")
        private val RE_QUOTE = Regex("^>[ \\t]*")

        private val RE_HTML_TAG = Regex("^</?[a-zA-Z][^>\\n]{0,500}>")
        private val RE_MODIFIER = Regex("^\\.\\([^()\\n]*\\)|^\\.\\[[^\\]\\n]*\\]|^\\.\\{[^}\\n]*\\}")
        private val RE_DIRECTIVE = Regex("^\\{\\{[^}\\n]*\\}\\}")
        private val RE_LINK = Regex("^\"[^\"\\n]{0,200}\":\\S{0,2000}")
        private val RE_IMAGE = Regex("^\\[\\*[^*<>\\]\\n]{0,200}(?:\\*|<|>)\\]")
        private val RE_REFERENCE = Regex("^\\[[^\\]\\n]{0,200}\\]")
        private val RE_ENTITY = Regex("^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});")
        private val RE_PHRASE_STAR = Regex("^\\*{1,3}")
        private val RE_PHRASE_TICK = Regex("^`{1,2}")
        private val RE_GFM_CLOSE = Regex("^[ \\t]*`{3,}[ \\t]*$")
    }
}
