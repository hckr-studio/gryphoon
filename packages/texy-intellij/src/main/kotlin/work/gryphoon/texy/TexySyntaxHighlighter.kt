package work.gryphoon.texy

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.lexer.Lexer
import com.intellij.psi.tree.IElementType

class TexySyntaxHighlighterFactory : SyntaxHighlighterFactory() {

    override fun getSyntaxHighlighter(project: Project?, virtualFile: VirtualFile?): SyntaxHighlighter =
        TexySyntaxHighlighter()
}

class TexySyntaxHighlighter : SyntaxHighlighter {

    override fun getHighlightingLexer(): Lexer = TexyLexer()

    override fun getTokenHighlights(tokenType: IElementType): Array<TextAttributesKey> =
        when (tokenType) {
            TexyTokenTypes.OPEN, TexyTokenTypes.CLOSE,
            TexyTokenTypes.FRONT_MATTER_OPEN, TexyTokenTypes.FRONT_MATTER_CLOSE,
            -> arrayOf(BLOCK_MARKER)

            TexyTokenTypes.MARK_HEADING -> arrayOf(HEADING)
            TexyTokenTypes.MARK_LIST, TexyTokenTypes.MARK_QUOTE -> arrayOf(BLOCK_MARKER)
            TexyTokenTypes.MARK_PHRASE -> arrayOf(PHRASE)
            TexyTokenTypes.HTML_TAG -> arrayOf(
                com.intellij.openapi.editor.DefaultLanguageHighlighterColors.MARKUP_TAG,
            )
            TexyTokenTypes.ENTITY -> arrayOf(
                DefaultLanguageHighlighterColors.MARKUP_ENTITY,
            )
            TexyTokenTypes.DIRECTIVE -> arrayOf(DIRECTIVE)
            TexyTokenTypes.LINK, TexyTokenTypes.IMAGE, TexyTokenTypes.REFERENCE -> arrayOf(LINK)
            TexyTokenTypes.MODIFIER -> arrayOf(MODIFIER)
            else -> EMPTY
        }

    companion object {
        val BLOCK_MARKER: TextAttributesKey = TextAttributesKey.createTextAttributesKey(
            "TEXY_BLOCK_MARKER",
            DefaultLanguageHighlighterColors.METADATA,
        )
        val HEADING: TextAttributesKey = TextAttributesKey.createTextAttributesKey(
            "TEXY_HEADING",
            DefaultLanguageHighlighterColors.KEYWORD,
        )
        val PHRASE: TextAttributesKey = TextAttributesKey.createTextAttributesKey(
            "TEXY_PHRASE",
            DefaultLanguageHighlighterColors.KEYWORD,
        )
        val LINK: TextAttributesKey = TextAttributesKey.createTextAttributesKey(
            "TEXY_LINK",
            com.intellij.openapi.editor.colors.CodeInsightColors.HYPERLINK_ATTRIBUTES,
        )
        val LINK_TARGET: TextAttributesKey = TextAttributesKey.createTextAttributesKey(
            "TEXY_LINK_TARGET",
            DefaultLanguageHighlighterColors.STRING,
        )
        val DIRECTIVE: TextAttributesKey = TextAttributesKey.createTextAttributesKey(
            "TEXY_DIRECTIVE",
            DefaultLanguageHighlighterColors.METADATA,
        )
        val MODIFIER: TextAttributesKey = TextAttributesKey.createTextAttributesKey(
            "TEXY_MODIFIER",
            DefaultLanguageHighlighterColors.LABEL,
        )
        val CODE_SPAN: TextAttributesKey = TextAttributesKey.createTextAttributesKey(
            "TEXY_CODE_SPAN",
            DefaultLanguageHighlighterColors.STRING,
        )
        private val EMPTY = arrayOf<TextAttributesKey>()
    }
}
