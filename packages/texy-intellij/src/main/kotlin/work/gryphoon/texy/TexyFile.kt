package work.gryphoon.texy

import com.intellij.extapi.psi.PsiFileBase
import com.intellij.openapi.fileTypes.FileType
import com.intellij.psi.FileViewProvider

class TexyFile(viewProvider: FileViewProvider) : PsiFileBase(viewProvider, TexyLanguage) {

    override fun getFileType(): FileType = TexyFileType

    override fun toString(): String = "TexyFile"
}
