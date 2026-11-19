package work.gryphoon.texy.settings

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project

/**
 * Project-level Texy settings, stored in `.idea/texy.xml`.
 *
 * `legacyReferences` enables the Texy 3 bare `[ref]` use syntax: a
 * standalone bracket reference resolves like a `"label":[ref]` use.
 * The value is passed to the language server when it starts and is
 * applied live via [com.intellij.platform.lsp.api.LspClientManager].
 *
 * `lineWidth` overrides the wrapping width for reformatting; `null`
 * follows the IDE right margin (Code Style | General | Hard wrap).
 *
 * `headingStyle` controls how reformatting rewrites headings
 * ([TexyHeadingStyle]); passed to the language server on start.
 */
@Service(Service.Level.PROJECT)
@State(name = "TexySettings", storages = [Storage("texy.xml")])
class TexySettings : PersistentStateComponent<TexySettings.State> {

    class State {
        var legacyReferences = true
        var lineWidth: Int? = null
        var headingStyle = TexyHeadingStyle.Preserve
    }

    private var myState = State()

    override fun getState(): State = myState

    override fun loadState(state: State) {
        myState = state
    }

    var legacyReferences: Boolean
        get() = myState.legacyReferences
        set(value) {
            myState.legacyReferences = value
        }

    /** Wrapping width for reformatting; `null` follows the IDE right margin. */
    var lineWidth: Int?
        get() = myState.lineWidth
        set(value) {
            myState.lineWidth = value
        }

    /** How reformatting rewrites headings; see [TexyHeadingStyle]. */
    var headingStyle: TexyHeadingStyle
        get() = myState.headingStyle
        set(value) {
            myState.headingStyle = value
        }

    companion object {
        fun getInstance(project: Project): TexySettings = project.service()
    }
}

/**
 * How reformatting rewrites headings, matching the server's
 * `TEXY_LSP_HEADING_STYLE` values.
 */
enum class TexyHeadingStyle(val label: String, val value: String) {
    /** Each heading keeps the notation it was written in. */
    Preserve("Keep each heading's notation", "preserve"),

    /** Convert to the written, `#`-prefixed form. */
    Inline("Convert to inline (`#######  Heading`)", "inline"),

    /** Convert to the underlined form (`Heading` + a marker line). */
    Multiline("Convert to underlined (`Heading` + `=====`)", "multiline");

    override fun toString(): String = label
}
