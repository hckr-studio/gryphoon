package work.gryphoon.texy

import com.intellij.lang.ASTNode
import com.intellij.lang.ParserDefinition
import com.intellij.lang.PsiParser
import com.intellij.lexer.Lexer
import com.intellij.openapi.project.Project
import com.intellij.psi.FileViewProvider
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.tree.IFileElementType
import com.intellij.psi.tree.TokenSet

class TexyParserDefinition : ParserDefinition {

    override fun createLexer(project: Project?): Lexer = TexyLexer()

    override fun createParser(project: Project?): PsiParser = TexyParser()

    override fun getFileNodeType(): IFileElementType = TexyElementTypes.FILE

    override fun createFile(viewProvider: FileViewProvider): PsiFile = TexyFile(viewProvider)

    override fun spaceExistenceTypeBetweenTokens(left: ASTNode, right: ASTNode): ParserDefinition.SpaceRequirements =
        ParserDefinition.SpaceRequirements.MAY

    override fun getWhitespaceTokens(): TokenSet = TokenSet.EMPTY

    override fun getCommentTokens(): TokenSet = TokenSet.EMPTY

    override fun getStringLiteralElements(): TokenSet = TokenSet.create(TexyTokenTypes.CODE)

    /**
     * Never reached in practice: the language's composites (BLOCK,
     * FRONT_MATTER_BLOCK) are created as PsiElements by [TexyASTFactory],
     * so the platform never needs a wrapper from here. Returning a fresh
     * CompositePsiElement would produce a detached, parentless element.
     */
    override fun createElement(node: ASTNode): PsiElement =
        throw IllegalStateException("Unexpected composite node: ${node.elementType}")
}
