package work.gryphoon.texy

import com.intellij.lang.ASTNode
import com.intellij.lang.PsiBuilder
import com.intellij.lang.PsiParser
import com.intellij.psi.tree.IElementType

/**
 * Builds the flat PSI: leaves for all lexed tokens and the two composites
 * the injection layer navigates: BLOCK (OPEN, CODE?, CLOSE) and
 * FRONT_MATTER_BLOCK (OPEN, HOST?, CLOSE) at the document start.
 */
class TexyParser : PsiParser {

    override fun parse(root: IElementType, builder: PsiBuilder): ASTNode {
        val fileMark = builder.mark()
        while (!builder.eof()) {
            when (builder.tokenType) {
                TexyTokenTypes.FRONT_MATTER_OPEN -> parseRegion(builder, TexyElementTypes.FRONT_MATTER_BLOCK, TexyTokenTypes.FRONT_MATTER_CLOSE)
                TexyTokenTypes.OPEN -> parseRegion(builder, TexyElementTypes.BLOCK, TexyTokenTypes.CLOSE)
                else -> builder.advanceLexer()
            }
        }
        fileMark.done(root)
        return builder.treeBuilt
    }

    /** Consumes OPEN, its host content, and the closing marker into one composite. */
    private fun parseRegion(builder: PsiBuilder, composite: IElementType, closeType: IElementType) {
        val region = builder.mark()
        builder.advanceLexer() // the opening line
        while (!builder.eof() && builder.tokenType !== closeType) {
            if (builder.tokenType == TexyTokenTypes.FRONT_MATTER_OPEN ||
                builder.tokenType == TexyTokenTypes.OPEN ||
                builder.tokenType == TexyTokenTypes.PLAIN ||
                builder.tokenType == TexyTokenTypes.MARK_HEADING ||
                builder.tokenType == TexyTokenTypes.MARK_LIST ||
                builder.tokenType == TexyTokenTypes.MARK_QUOTE
            ) {
                break // a new line started: the region is unterminated
            }
            builder.advanceLexer()
        }
        if (!builder.eof() && builder.tokenType === closeType) {
            builder.advanceLexer()
        }
        region.done(composite)
    }
}
