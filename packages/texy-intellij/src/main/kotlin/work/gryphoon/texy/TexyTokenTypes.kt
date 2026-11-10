package work.gryphoon.texy

import com.intellij.psi.tree.IElementType
import com.intellij.psi.tree.IFileElementType
import com.intellij.psi.tree.TokenSet

/** Lexer token types. */
object TexyTokenTypes {

    /** Ordinary Texy text. */
    val PLAIN = IElementType("TEXY_PLAIN", TexyLanguage)

    // code blocks and front matter: injection hosts

    /** A block/fence opening line (`/-- code js`, ```` ```js ````). */
    val OPEN = IElementType("TEXY_BLOCK_OPEN", TexyLanguage)

    /** Code block content - the language-injection host. */
    val CODE = IElementType("TEXY_BLOCK_CODE", TexyLanguage)

    /** A block/fence closing line (`\--`, ```` ``` ````). */
    val CLOSE = IElementType("TEXY_BLOCK_CLOSE", TexyLanguage)

    /** The opening `---` line of the front matter (document start). */
    val FRONT_MATTER_OPEN = IElementType("TEXY_FM_OPEN", TexyLanguage)

    /** Front matter content - the language-injection host (yaml or EDN). */
    val FRONT_MATTER = IElementType("TEXY_FM", TexyLanguage)

    /** The closing `---` line of the front matter. */
    val FRONT_MATTER_CLOSE = IElementType("TEXY_FM_CLOSE", TexyLanguage)

    // texy syntax: line and inline markers

    /** `#`-style heading markers and underline/HR (`===`, `---`, `***`) lines. */
    val MARK_HEADING = IElementType("TEXY_MARK_HEADING", TexyLanguage)

    /** List bullets (`-`, `*`, `+`, `1.`, `1)`). */
    val MARK_LIST = IElementType("TEXY_MARK_LIST", TexyLanguage)

    /** Blockquote `>` prefixes. */
    val MARK_QUOTE = IElementType("TEXY_MARK_QUOTE", TexyLanguage)

    /** Phrase marks (`**`, `*`, `//`, `` ` ``). */
    val MARK_PHRASE = IElementType("TEXY_MARK_PHRASE", TexyLanguage)

    /** A passthrough HTML tag `<...>`. */
    val HTML_TAG = IElementType("TEXY_HTML_TAG", TexyLanguage)

    /** An HTML entity `&...;`. */
    val ENTITY = IElementType("TEXY_ENTITY", TexyLanguage)

    /** A `{{...}}` directive. */
    val DIRECTIVE = IElementType("TEXY_DIRECTIVE", TexyLanguage)

    /** A `"text":url` link. */
    val LINK = IElementType("TEXY_LINK", TexyLanguage)

    /** An `[*image*]` reference. */
    val IMAGE = IElementType("TEXY_IMAGE", TexyLanguage)

    /** A bare `[reference]`. */
    val REFERENCE = IElementType("TEXY_REFERENCE", TexyLanguage)

    /** A modifier: `.(title)[class]{style}`. */
    val MODIFIER = IElementType("TEXY_MODIFIER", TexyLanguage)

    /** The tokens whose sequences are re-queried by the injector/parser. */
    val HOSTS: TokenSet = TokenSet.create(CODE, FRONT_MATTER)
}

/** Composite element types (built by the parser). */
object TexyElementTypes {

    /** The whole file. */
    val FILE: IFileElementType = object : IFileElementType(TexyLanguage) {}

    /** A complete block: OPEN, CODE?, CLOSE. */
    val BLOCK = IElementType("TEXY_BLOCK", TexyLanguage)

    /** The front matter: OPEN, HOST, CLOSE (document start only). */
    val FRONT_MATTER_BLOCK = IElementType("TEXY_FM_BLOCK", TexyLanguage)
}
