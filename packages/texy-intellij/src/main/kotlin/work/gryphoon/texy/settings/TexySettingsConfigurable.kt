package work.gryphoon.texy.settings

import com.intellij.application.options.CodeStyle
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogPanel
import com.intellij.platform.lsp.api.LspClientManager
import com.intellij.ui.dsl.builder.bindItem
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel
import work.gryphoon.texy.TexyLanguage
import work.gryphoon.texy.lsp.TexyLspServerSupportProvider

/**
 * Settings → Languages &amp; Frameworks → Texy. The controls bind directly to
 * [TexySettings] and the DSL panel (via [BoundConfigurable]) owns
 * apply/reset/isModified over those bindings - so the Apply button tracks
 * actual edits and reset re-renders the controls from the service. Apply
 * restarts the language server so the new values take effect immediately.
 */
class TexySettingsConfigurable(private val project: Project) : BoundConfigurable("Texy") {

    override fun createPanel(): DialogPanel {
        val settings = TexySettings.getInstance(project)
        return panel {
            row {
                checkBox("Texy 3 legacy references: a standalone [ref] in text resolves as a reference use")
                    .bindSelected({ settings.legacyReferences }, { settings.legacyReferences = it })
            }
            row("Wrapping width:") {
                val rightMargin = CodeStyle.getSettings(project).getRightMargin(TexyLanguage)
                intTextField(20..500)
                    .bindText(
                        { settings.lineWidth?.toString() ?: "" },
                        { settings.lineWidth = if (it.isBlank()) null else it.toIntOrNull() },
                    )
                    .comment("Empty follows the IDE right margin for Texy (currently $rightMargin)")
            }
            row("Heading style:") {
                comboBox(TexyHeadingStyle.entries)
                    .bindItem({ settings.headingStyle }, { settings.headingStyle = it ?: TexyHeadingStyle.Preserve })
                    .comment("How the formatter rewrites headings: keep, convert to inline (`#####`-prefixed), or to underlined")
            }
        }
    }

    override fun apply() {
        super.apply() // panel validation, then the bindings write into TexySettings
        LspClientManager.getInstance(project)
            .stopAndRestartClientsIfNeeded(TexyLspServerSupportProvider::class.java)
    }
}
