package work.gryphoon.texy.settings

import com.intellij.application.options.CodeStyle
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.Project
import com.intellij.platform.lsp.api.LspClientManager
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel
import work.gryphoon.texy.TexyLanguage
import work.gryphoon.texy.lsp.TexyLspServerSupportProvider
import javax.swing.JComponent

/**
 * Settings → Languages &amp; Frameworks → Texy. The controls bind to
 * [TexySettings]; Apply restarts the language server so the new values
 * take effect immediately.
 */
class TexySettingsConfigurable(private val project: Project) : Configurable {

    private var legacyReferences = false
    private var lineWidth: Int? = null

    override fun getDisplayName() = "Texy"

    override fun createComponent(): JComponent = panel {
        row {
            checkBox("Texy 3 legacy references: a standalone [ref] in text resolves as a reference use")
                .bindSelected({ legacyReferences }, { legacyReferences = it })
        }
        row("Wrapping width:") {
            val rightMargin = CodeStyle.getSettings(project).getRightMargin(TexyLanguage)
            intTextField(20..500)
                .bindText({ lineWidth?.toString() ?: "" }, { lineWidth = if (it.isBlank()) null else it.toIntOrNull() })
                .comment("Empty follows the IDE right margin for Texy (currently $rightMargin)")
        }
    }

    override fun isModified(): Boolean {
        val settings = TexySettings.getInstance(project)
        return legacyReferences != settings.legacyReferences || lineWidth != settings.lineWidth
    }

    override fun reset() {
        val settings = TexySettings.getInstance(project)
        legacyReferences = settings.legacyReferences
        lineWidth = settings.lineWidth
    }

    override fun apply() {
        val settings = TexySettings.getInstance(project)
        settings.legacyReferences = legacyReferences
        settings.lineWidth = lineWidth
        LspClientManager.getInstance(project)
            .stopAndRestartClientsIfNeeded(TexyLspServerSupportProvider::class.java)
    }
}
