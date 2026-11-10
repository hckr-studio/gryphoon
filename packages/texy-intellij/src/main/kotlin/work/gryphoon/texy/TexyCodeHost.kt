package work.gryphoon.texy

import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.util.TextRange
import com.intellij.psi.ElementManipulator
import com.intellij.psi.LiteralTextEscaper
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiLanguageInjectionHost
import com.intellij.psi.impl.source.tree.LeafPsiElement
import com.intellij.psi.tree.IElementType

/**
 * The content of a code block or the front matter: the language-injection
 * host. The injected language is derived from the region: block hosts read
 * their block's opening line (the previous sibling in the composite), the
 * front matter host picks yaml, or EDN when the section starts with `{:`.
 */
class TexyCodeHost(type: IElementType, text: CharSequence) :
    LeafPsiElement(type, text), PsiLanguageInjectionHost {

    /** True when the host is the front matter content (yaml/EDN). */
    val isFrontMatter: Boolean
        get() = elementType === TexyTokenTypes.FRONT_MATTER

    /** The language name written in the block's opening line, null when none. */
    fun injectedLanguageName(): String? {
        var sibling: PsiElement? = this
        while (sibling != null && sibling.node.elementType !== TexyTokenTypes.OPEN) {
            sibling = sibling.prevSibling
        }
        return sibling?.let { TexyBlockLanguages.fromOpeningLine(it.text) }
    }

    override fun isValidHost() = true

    override fun updateText(text: String): PsiLanguageInjectionHost {
        val document = containingFile.viewProvider.document
        if (document != null) {
            val range = textRange
            WriteCommandAction.runWriteCommandAction(project) {
                document.replaceString(range.startOffset, range.endOffset, text)
            }
        }
        return this
    }

    override fun createLiteralTextEscaper(): LiteralTextEscaper<out PsiLanguageInjectionHost> =
        LiteralTextEscaper.createSimple(this)
}

/**
 * Content changes of the injected fragment, written back into the host's
 * range of the document.
 */
class TexyCodeManipulator : ElementManipulator<TexyCodeHost> {

    override fun getRangeInElement(element: TexyCodeHost) = TextRange(0, element.textLength)

    override fun handleContentChange(element: TexyCodeHost, newContent: String): TexyCodeHost? =
        handleContentChange(element, getRangeInElement(element), newContent)

    override fun handleContentChange(element: TexyCodeHost, range: TextRange, newContent: String): TexyCodeHost? {
        val document = element.containingFile.viewProvider.document ?: return null
        val start = element.textRange.startOffset + range.startOffset
        val end = element.textRange.startOffset + range.endOffset
        WriteCommandAction.runWriteCommandAction(element.project) {
            document.replaceString(start, end, newContent)
        }
        return element
    }
}
