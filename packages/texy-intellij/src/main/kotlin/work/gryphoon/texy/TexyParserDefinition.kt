package work.gryphoon.texy

import com.intellij.lang.ASTNode
import com.intellij.lang.ParserDefinition
import com.intellij.lang.PsiParser
import com.intellij.lexer.Lexer
import com.intellij.openapi.project.Project
import com.intellij.psi.FileViewProvider
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.impl.source.tree.CompositePsiElement
import com.intellij.psi.tree.IFileElementType
import com.intellij.psi.tree.TokenSet

class TexyParserDefinition : ParserDefinition {

    override fun createLexer(project: Project?): Lexer = TexyLexer()

    override fun createParser(project: Project?): PsiParser = TexyParser()

    override fun getFileNodeType(): IFileElementType = TexyElementTypes.FILE

    override fun createFile(viewProvider: FileViewProvider): PsiFile = TexyFile(viewProvider)

    override fun spaceExistanceTypeBetweenTokens(left: ASTNode, right: ASTNode): ParserDefinition.SpaceRequirements =
        ParserDefinition.SpaceRequirements.MAY

    override fun getWhitespaceTokens(): TokenSet = TokenSet.EMPTY

    override fun getCommentTokens(): TokenSet = TokenSet.EMPTY

    override fun getStringLiteralElements(): TokenSet = TokenSet.create(TexyTokenTypes.CODE)

    override fun createElement(node: ASTNode): PsiElement =
        when (node.elementType) {
            TexyElementTypes.BLOCK -> TexyBlockNode()
            else -> object : CompositePsiElement(node.elementType) {}
        }
}

/** The BLOCK composite: OPEN, CODE?, CLOSE. */
class TexyBlockNode : CompositePsiElement(TexyElementTypes.BLOCK) {
    override fun toString() = "TexyBlock"
}
