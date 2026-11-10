package work.gryphoon.texy

/**
 * The language of a code block, read off its opening line. Mirrors the
 * converter's block grammar:
 *
 *  - `/-- code js ...` and `/-- pre js ...`: the second word is the language
 *  - `/--js ...` (a lone, language-shaped word): that word is the language
 *  - `/-- html ...`: an HTML fragment
 *  - ```` ```js info ````: the first word of the info string (GFM)
 *
 * Structural types (div, text, comment, texysource) never carry a language.
 */
object TexyBlockLanguages {

    private val NON_CODE_TYPES = setOf("div", "text", "comment", "texy", "texysource", "notexy")

    /** The language name of a block opening line, null when not a code block or none given. */
    fun fromOpeningLine(line: String): String? {
        val trimmed = line.trim()
        val backticks = trimmed.takeWhile { it == '`' }.length
        if (backticks >= 3) {
            // GFM: first word of the info string
            return trimmed.drop(backticks).trim().split(Regex("\\s+")).firstOrNull()?.takeIf { it.isNotEmpty() }
        }
        if (!trimmed.startsWith("/--")) return null
        val rest = trimmed.substring(3).trim()
        val words = rest.split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return null
        val type = words.first().lowercase()
        if (type in NON_CODE_TYPES) return null
        return when (type) {
            "code", "pre" -> words.getOrNull(1)?.takeIf { it.isNotEmpty() }
                ?: if (type == "code" || type == "pre") null else null
            "html" -> "html"
            else -> words.first().takeIf { it.matches(Regex("^[A-Za-z][A-Za-z0-9_+#.-]*$")) }
        }
    }
}
