package work.gryphoon.texy

import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.fileTypes.LanguageFileType

object TexyFileType : LanguageFileType(TexyLanguage) {

    override fun getName(): String = "Texy"

    override fun getDescription(): String = "Texy! document"

    override fun getDefaultExtension(): String = "texy"

    override fun getIcon() = IconLoader.getIcon("/icons/texy.svg", TexyFileType::class.java)
}
