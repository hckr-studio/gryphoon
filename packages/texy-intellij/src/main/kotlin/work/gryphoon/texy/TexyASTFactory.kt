package work.gryphoon.texy

import com.intellij.lang.ASTFactory
import com.intellij.psi.impl.source.tree.LeafPsiElement
import com.intellij.psi.tree.IElementType

/**
 * Creates the injection-host leaves (code blocks and front matter);
 * everything else keeps the platform defaults.
 */
class TexyASTFactory : ASTFactory() {

    override fun createLeaf(type: IElementType, text: CharSequence): LeafPsiElement? =
        if (type === TexyTokenTypes.CODE || type === TexyTokenTypes.FRONT_MATTER) {
            TexyCodeHost(type, text)
        } else {
            null
        }
}
