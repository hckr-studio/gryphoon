package work.gryphoon.texy.inject

import com.intellij.lang.Language
import com.intellij.lang.injection.MultiHostInjector
import com.intellij.lang.injection.MultiHostRegistrar
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiElement
import work.gryphoon.texy.TexyCodeHost
import work.gryphoon.texy.TexyTokenTypes

/**
 * Injects the IDE language into the Texy injection hosts:
 *  - code blocks: the language of the opening line (js, ts, css, php, sql, ...)
 *    resolved to a registered IDE language, unknown names stay plain texy
 *  - the front matter: yaml by default, EDN when the section starts with `{:`
 *    (EDN resolves to the Clojure language when a Clojure plugin is
 *    installed, otherwise to the bundled EDN TextMate grammar)
 */
class TexyBlockInjector : MultiHostInjector {

    override fun elementsToInjectIn(): List<Class<out PsiElement>> =
        listOf(TexyCodeHost::class.java)

    override fun getLanguagesToInject(registrar: MultiHostRegistrar, context: PsiElement) {
        if (context !is TexyCodeHost) return
        val language = if (context.isFrontMatter) {
            frontMatterLanguage(context)
        } else {
            context.injectedLanguageName()?.let { TexyLanguages.resolve(it) }
        } ?: return
        registrar
            .startInjecting(language)
            .addPlace(null, null, context, TextRange(0, context.textLength))
            .doneInjecting()
    }

    private fun frontMatterLanguage(host: TexyCodeHost): Language? {
        val content = host.text.trimStart()
        return if (content.startsWith("{:")) {
            TexyLanguages.resolveEdn()
        } else {
            TexyLanguages.resolveYaml()
        }
    }
}

/** Fence/front-matter language aliases to IDE language IDs. */
object TexyLanguages {

    private val aliases: Map<String, String> = mapOf(
        "js" to "JavaScript",
        "javascript" to "JavaScript",
        "jsx" to "JavaScript",
        "ts" to "TypeScript",
        "typescript" to "TypeScript",
        "tsx" to "TypeScript",
        "json" to "JSON",
        "jsonc" to "JSON",
        "json5" to "JSON",
        "html" to "HTML",
        "htm" to "HTML",
        "xml" to "XML",
        "svg" to "XML",
        "css" to "CSS",
        "scss" to "SCSS",
        "sass" to "SCSS",
        "less" to "LESS",
        "styl" to "Stylus",
        "sql" to "SQL",
        "mysql" to "MySQL",
        "pgsql" to "PostgreSQL",
        "sh" to "Shell Script",
        "bash" to "Shell Script",
        "zsh" to "Shell Script",
        "shell" to "Shell Script",
        "console" to "Shell Script",
        "yaml" to "yaml",
        "yml" to "yaml",
        "ini" to "Ini",
        "properties" to "Properties",
        "php" to "PHP",
        "py" to "Python",
        "python" to "Python",
        "rb" to "Ruby",
        "ruby" to "Ruby",
        "java" to "JAVA",
        "kt" to "kotlin",
        "kotlin" to "kotlin",
        "kts" to "kotlin",
        "go" to "go",
        "rs" to "Rust",
        "rust" to "Rust",
        "c" to "C",
        "h" to "C",
        "cpp" to "C++",
        "c++" to "C++",
        "cs" to "C#",
        "csharp" to "C#",
        "swift" to "Swift",
        "lua" to "Lua",
        "perl" to "Perl",
        "groovy" to "Groovy",
        "gradle" to "Groovy",
        "markdown" to "Markdown",
        "md" to "Markdown",
        "docker" to "Docker",
        "dockerfile" to "Docker",
        "regex" to "RegExp",
        "regexp" to "RegExp",
        "text" to "TEXT",
        "texy" to "Texy",
    )

    /** The registered IDE language, null when nothing matches (the block stays texy). */
    fun resolve(languageName: String): Language? {
        val target = aliases[languageName.lowercase()] ?: languageName
        return Language.findLanguageByID(target)
    }

    /** The builtin yaml language. */
    fun resolveYaml(): Language? = Language.findLanguageByID("yaml")

    /** EDN: the Clojure language family - a Clojure plugin when installed, else the bundled EDN TextMate grammar. */
    fun resolveEdn(): Language? =
        Language.findLanguageByID("Clojure")
            ?: Language.findLanguageByID("EDN")
            ?: Language.findLanguageByID("edn")
}
