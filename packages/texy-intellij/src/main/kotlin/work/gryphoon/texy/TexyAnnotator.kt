package work.gryphoon.texy

import com.intellij.lang.ASTNode
import com.intellij.lang.annotation.AnnotationHolder
import com.intellij.lang.annotation.Annotator
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiElement
import com.intellij.psi.impl.source.tree.LeafElement
import com.intellij.psi.impl.source.tree.LeafPsiElement

/**
 * Colors the texy tokens, mirroring how the bundled Markdown plugin
 * highlights: an annotator over the lexed leaves (the syntax-highlighter
 * factory alone never reaches the editor for injected-editor host files).
 *
 * Cross-token spans pair up like their Markdown equivalents, emitted from
 * the file element because annotation ranges must stay inside the element
 * being annotated:
 *  - `**...**` bold, `*...*` / `//...//` italic
 *  - `` `...` `` inline code span
 *  - `#`-heading: the whole line; underline heading: the previous line
 */
class TexyAnnotator : Annotator {

    override fun annotate(element: PsiElement, holder: AnnotationHolder) {
        when (element) {
            is TexyFile -> annotateSpans(element, holder)
            is LeafPsiElement -> annotateLeaf(element, holder)
        }
    }

    private fun annotateLeaf(leaf: LeafPsiElement, holder: AnnotationHolder) {
        when (leaf.elementType) {
            TexyTokenTypes.LINK -> annotateLink(leaf, holder)
            else -> annotateLeafKey(leaf, holder)
        }
    }

    private fun annotateLeafKey(leaf: LeafPsiElement, holder: AnnotationHolder) {
        val key = when (leaf.elementType) {
            TexyTokenTypes.MARK_PHRASE -> TexySyntaxHighlighter.PHRASE
            TexyTokenTypes.MARK_HEADING -> TexySyntaxHighlighter.HEADING
            TexyTokenTypes.HTML_TAG -> DefaultLanguageHighlighterColors.MARKUP_TAG
            TexyTokenTypes.ENTITY -> DefaultLanguageHighlighterColors.MARKUP_ENTITY
            TexyTokenTypes.IMAGE, TexyTokenTypes.REFERENCE -> TexySyntaxHighlighter.LINK
            TexyTokenTypes.DIRECTIVE -> TexySyntaxHighlighter.DIRECTIVE
            TexyTokenTypes.MODIFIER -> TexySyntaxHighlighter.MODIFIER
            TexyTokenTypes.OPEN, TexyTokenTypes.CLOSE,
            TexyTokenTypes.FRONT_MATTER_OPEN, TexyTokenTypes.FRONT_MATTER_CLOSE,
            TexyTokenTypes.MARK_LIST, TexyTokenTypes.MARK_QUOTE,
            -> TexySyntaxHighlighter.BLOCK_MARKER
            else -> return
        }
        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
            .range(leaf as PsiElement)
            .textAttributes(key)
            .create()
    }

    /**
     * `"label":target` - the label keeps the hyperlink style, the target
     * after the closing quote's colon gets its own (string-family) color,
     * the way Markdown explicit links distinguish text and destination.
     */
    private fun annotateLink(leaf: LeafPsiElement, holder: AnnotationHolder) {
        val text = leaf.text.trimEnd('\n', '\r')
        val start = leaf.startOffset
        val end = start + text.length
        val separator = text.indexOf("\":")
        if (separator < 0) {
            holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
                .range(leaf as PsiElement)
                .textAttributes(TexySyntaxHighlighter.LINK)
                .create()
            return
        }
        val colonEnd = start + separator + 2 // include the ':' with the target
        // the quotes stay plain; only the label content is underlined
        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
            .range(TextRange(start, start + 1))
            .textAttributes(DefaultLanguageHighlighterColors.IDENTIFIER)
            .create()
        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
            .range(TextRange(start + 1, start + separator))
            .textAttributes(TexySyntaxHighlighter.LINK)
            .create()
        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
            .range(TextRange(start + separator, start + separator + 1))
            .textAttributes(DefaultLanguageHighlighterColors.IDENTIFIER)
            .create()
        holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
            .range(TextRange(colonEnd, end))
            .textAttributes(TexySyntaxHighlighter.LINK_TARGET)
            .create()
    }

    /**
     * Pairs phrase marks and styles heading text. Texy inline tokens are
     * file-level leaf siblings (the parser groups only blocks); a leaf
     * carrying `\n` (and the line terminator merged into it) ends the
     * pending pairs and the line.
     */
    private fun annotateSpans(file: TexyFile, holder: AnnotationHolder) {
        val pending = ArrayDeque<LeafElement>()
        var node: ASTNode? = file.node.firstChildNode
        while (node != null) {
            if (node is LeafElement) {
                when (node.elementType) {
                    TexyTokenTypes.MARK_PHRASE -> annotatePhraseMark(node, pending, holder)
                    TexyTokenTypes.MARK_HEADING -> annotateHeading(node, holder)
                }
                if (node.text.contains('\n')) {
                    pending.clear()
                }
            }
            node = node.treeNext
        }
    }

    private fun annotatePhraseMark(node: LeafElement, pending: ArrayDeque<LeafElement>, holder: AnnotationHolder) {
        // a phrase mark ending the line absorbs the trailing newline
        val mark = node.text.trimEnd('\n', '\r')
        val opening = pending.firstOrNull()?.takeIf { it.text.trimEnd('\n', '\r') == mark }
        if (opening == null) {
            pending.addFirst(node)
            return
        }
        pending.removeFirst()
        val start = opening.startOffset + opening.text.trimEnd('\n', '\r').length
        val end = node.startOffset
        if (end <= start) return
        when {
            // inline code span, rendered exactly like a Markdown code span
            mark.startsWith("`") -> {
                val markdown = markdownAttributes("MARKDOWN_CODE_SPAN")
                silent(holder, start, end, if (markdown == null) TexySyntaxHighlighter.CODE_SPAN else null, markdown)
            }
            // bold / italic emphasis, rendered exactly like Markdown emphasis
            else -> {
                val markdown = emphasisMarkdownKey(mark)?.let { markdownAttributes(it) }
                val fontType = if (markdown == null) emphasisFontType(mark) else null
                if (markdown != null || fontType != null) {
                    val enforced = markdown ?: TextAttributes(null, null, null, null, fontType ?: java.awt.Font.PLAIN)
                    silent(holder, start, end, null, enforced)
                }
            }
        }
    }

    /** `**` -> bold, `*` / `//` -> italic. */
    private fun emphasisFontType(mark: String): Int? = when (mark) {
        "**" -> java.awt.Font.BOLD
        "*", "//" -> java.awt.Font.ITALIC
        else -> null
    }

    private fun emphasisMarkdownKey(mark: String): String? = when (mark) {
        "**" -> "MARKDOWN_BOLD"
        "*", "//" -> "MARKDOWN_ITALIC"
        else -> null
    }

    /**
     * Attributes of a Markdown scheme key in the active scheme, or null when
     * the scheme defines none (Markdown plugin absent, custom legacy scheme).
     * Enforcing the resolved attributes renders spans identically to .md
     * files, following every theme and user color customization.
     */
    private fun markdownAttributes(markdownKey: String): TextAttributes? {
        val key = com.intellij.openapi.editor.colors.TextAttributesKey.find(markdownKey)
        return com.intellij.openapi.editor.colors.EditorColorsManager.getInstance()
            .globalScheme.getAttributes(key)
    }

    /** `# heading` styles the line content; an underline styles the previous line. */
    private fun annotateHeading(node: LeafElement, holder: AnnotationHolder) {
        if (node.text.startsWith("#")) {
            annotateHeadingContent(node, holder)
        } else {
            annotateUnderlinedHeading(node, holder)
        }
    }

    /** The content after a `#`-marker up to the line end, colored like a heading. */
    private fun annotateHeadingContent(mark: LeafElement, holder: AnnotationHolder) {
        val start = mark.startOffset + mark.text.trimEnd('\n', '\r').length
        var end = mark.startOffset + mark.text.trimEnd('\n', '\r').length
        var node: ASTNode? = mark
        while (node != null) {
            val index = node.text.indexOf('\n')
            if (index >= 0) {
                end = node.startOffset + index
                break
            }
            end = node.startOffset + node.text.length
            node = node.treeNext
        }
        // `#` count == heading level, rendered like the same-level Markdown heading
        val level = mark.text.takeWhile { it == '#' }.length.coerceIn(1, 6)
        if (end > start) {
            annotateHeadingSpan(holder, start, end, level)
        }
    }

    /** The whole leaf line before a `===`/`---`/`***` underline, colored like a heading. */
    private fun annotateUnderlinedHeading(decoration: LeafElement, holder: AnnotationHolder) {
        val previous = decoration.treePrev as? LeafElement ?: return
        val text = previous.text
        if (text.isBlank()) return
        // `===` underlines a level-1 heading, the others level-2
        val level = if (decoration.text.startsWith("=")) 1 else 2
        val end = previous.startOffset + text.trimEnd('\n', '\r').length
        annotateHeadingSpan(holder, previous.startOffset, end, level)
    }

    /** Heading text rendered exactly like the same-level Markdown heading. */
    private fun annotateHeadingSpan(holder: AnnotationHolder, start: Int, end: Int, level: Int) {
        if (end <= start) return
        val markdown = markdownAttributes("MARKDOWN_HEADER_LEVEL_$level")
        if (markdown != null) {
            silent(holder, start, end, null, markdown)
        } else {
            silent(holder, start, end, TexySyntaxHighlighter.HEADING, null)
        }
    }

    private fun silent(
        holder: AnnotationHolder,
        start: Int,
        end: Int,
        key: TextAttributesKey?,
        enforced: TextAttributes?,
    ) {
        val annotation = holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
            .range(TextRange(start, end))
        if (key != null) {
            annotation.textAttributes(key)
        }
        if (enforced != null) {
            annotation.enforcedTextAttributes(enforced)
        }
        annotation.create()
    }
}
