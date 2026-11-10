package work.gryphoon.texy

import com.intellij.lang.ASTFactory
import com.intellij.psi.impl.source.tree.CompositeElement
import com.intellij.psi.impl.source.tree.CompositePsiElement
import com.intellij.psi.impl.source.tree.LeafPsiElement
import com.intellij.psi.tree.IElementType

/**
 * Creates the injection-host leaves (code blocks and front matter) and the
 * composite tree nodes (BLOCK, FRONT_MATTER_BLOCK) as PsiElements in place.
 *
 * A composite that is not itself a PsiElement would be lazily wrapped by
 * [TexyParserDefinition.createElement] into a freshly constructed
 * [CompositePsiElement] that was never linked into the tree: its tree parent
 * is null, so every parent-walking pass (injection probing, inspections,
 * spellchecking) hits an invalid PSI element and the highlighting layers
 * abort for the whole file.
 */
class TexyASTFactory : ASTFactory() {

    override fun createLeaf(type: IElementType, text: CharSequence): LeafPsiElement? =
        if (type === TexyTokenTypes.CODE || type === TexyTokenTypes.FRONT_MATTER) {
            TexyCodeHost(type, text)
        } else {
            null
        }

    override fun createComposite(type: IElementType): CompositeElement? =
        when (type) {
            TexyElementTypes.BLOCK -> TexyBlockNode()
            TexyElementTypes.FRONT_MATTER_BLOCK -> TexyFrontMatterNode()
            else -> null
        }
}

/** The BLOCK composite: OPEN, CODE?, CLOSE. */
class TexyBlockNode : CompositePsiElement(TexyElementTypes.BLOCK) {
    override fun toString() = "TexyBlock"
}

/** The front matter composite: OPEN, HOST?, CLOSE (document start only). */
class TexyFrontMatterNode : CompositePsiElement(TexyElementTypes.FRONT_MATTER_BLOCK) {
    override fun toString() = "TexyFrontMatter"
}
