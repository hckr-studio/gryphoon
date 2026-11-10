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

/**
 * Fence/front-matter language aliases to IDE language IDs. Keyed by the
 * names the blog's prism.js build uses; the values are candidate IDE
 * language IDs tried in order, so an alias falls back to a close dialect
 * when the exact language is not installed (e.g. `tsx` -> TSX, then
 * TypeScript). Unknown tags that match no alias are tried against the
 * IDE by their own name as-is.
 */
object TexyLanguages {

    private val aliases: Map<String, List<String>> = mapOf(
        // prism "markup" family
        "markup" to listOf("HTML"),
        "html" to listOf("HTML"),
        "htm" to listOf("HTML"),
        "xhtml" to listOf("HTML"),
        "xml" to listOf("XML"),
        "svg" to listOf("XML"),
        "mathml" to listOf("XML"),
        "ssml" to listOf("XML"),
        "plist" to listOf("XML"),

        // stylesheets
        "css" to listOf("CSS"),
        "scss" to listOf("SCSS"),
        "sass" to listOf("SCSS"),
        "less" to listOf("LESS"),
        "styl" to listOf("Stylus"),
        "stylus" to listOf("Stylus"),

        // javascript & friends
        "js" to listOf("JavaScript"),
        "javascript" to listOf("JavaScript"),
        "jsx" to listOf("JavaScript"),
        "jsdoc" to listOf("JavaScript"),
        "ts" to listOf("TypeScript"),
        "typescript" to listOf("TypeScript"),
        "tsx" to listOf("TSX", "TypeScript"),
        "json" to listOf("JSON"),
        "jsonc" to listOf("JSON with Comments", "JSON"),
        "json5" to listOf("JSON5", "JSON"),
        "coffeescript" to listOf("CoffeeScript"),
        "coffee" to listOf("CoffeeScript"),
        "vue" to listOf("Vue", "Vue.js"),
        "svelte" to listOf("Svelte"),
        "astro" to listOf("Astro"),
        "ejs" to listOf("EJS"),
        "handlebars" to listOf("Handlebars"),
        "hbs" to listOf("Handlebars"),
        "pug" to listOf("Pug", "Jade"),
        "jade" to listOf("Pug", "Jade"),
        "twig" to listOf("Twig"),

        // templates & configs
        "yaml" to listOf("yaml"),
        "yml" to listOf("yaml"),
        "ini" to listOf("Ini"),
        "toml" to listOf("TOML"),
        "properties" to listOf("Properties"),
        "docker" to listOf("Docker"),
        "dockerfile" to listOf("Docker"),

        // jvm
        "java" to listOf("JAVA"),
        "kt" to listOf("kotlin"),
        "kotlin" to listOf("kotlin"),
        "kts" to listOf("kotlin"),
        "groovy" to listOf("Groovy"),
        "gradle" to listOf("Groovy"),
        "scala" to listOf("Scala"),
        "clj" to listOf("Clojure"),
        "clojure" to listOf("Clojure"),

        // systems languages
        "c" to listOf("C"),
        "h" to listOf("C"),
        "cpp" to listOf("C++"),
        "c++" to listOf("C++"),
        "cc" to listOf("C++"),
        "hpp" to listOf("C++"),
        "cs" to listOf("C#"),
        "csharp" to listOf("C#"),
        "dotnet" to listOf("C#"),
        "aspnet" to listOf("ASP.NET", "C#"),
        "fsharp" to listOf("F#", "FSharp"),
        "fs" to listOf("F#", "FSharp"),
        // boo has no JetBrains language; Python is its closest relative
        "boo" to listOf("Boo", "Python"),
        "haml" to listOf("HAML"),
        "go" to listOf("go"),
        "golang" to listOf("go"),
        "rs" to listOf("Rust"),
        "rust" to listOf("Rust"),
        "swift" to listOf("Swift"),
        "objective" to listOf("ObjectiveC"),
        "objectivec" to listOf("ObjectiveC"),
        "objc" to listOf("ObjectiveC"),
        "dart" to listOf("Dart"),
        "zig" to listOf("Zig"),

        // scripting & shells
        "php" to listOf("PHP"),
        "py" to listOf("Python"),
        "python" to listOf("Python"),
        "rb" to listOf("Ruby"),
        "ruby" to listOf("Ruby"),
        "perl" to listOf("Perl"),
        "lua" to listOf("Lua"),
        "sh" to listOf("Shell Script"),
        "bash" to listOf("Shell Script"),
        "zsh" to listOf("Shell Script"),
        "shell" to listOf("Shell Script"),
        "shell-session" to listOf("Shell Script"),
        "console" to listOf("Shell Script"),
        "powershell" to listOf("PowerShell"),
        "ps" to listOf("PowerShell"),
        "ps1" to listOf("PowerShell"),
        "bat" to listOf("Batch Script"),
        "batch" to listOf("Batch Script"),
        "makefile" to listOf("Makefile"),
        "cmake" to listOf("CMake"),

        // data & queries
        "sql" to listOf("SQL"),
        "mysql" to listOf("MySQL", "SQL"),
        "pgsql" to listOf("PostgreSQL", "SQL"),
        "psql" to listOf("PostgreSQL", "SQL"),
        "plsql" to listOf("SQL"),
        "graphql" to listOf("GraphQL"),
        "gql" to listOf("GraphQL"),
        "hcl" to listOf("HCL"),
        "terraform" to listOf("HCL"),

        // prose & misc
        "markdown" to listOf("Markdown"),
        "md" to listOf("Markdown"),
        "regexp" to listOf("RegExp"),
        "regex" to listOf("RegExp"),
        "nix" to listOf("Nix"),
        "text" to listOf("TEXT", "Plain Text"),
        "plain" to listOf("TEXT", "Plain Text"),
        "plaintext" to listOf("TEXT", "Plain Text"),
        "txt" to listOf("TEXT", "Plain Text"),
        "texy" to listOf("Texy"),
    )

    /** The registered IDE language, null when nothing matches (the block stays texy). */
    fun resolve(languageName: String): Language? {
        // prism-style `language-js` prefixes and stray case are normalized
        val name = languageName.trim().removePrefix("language-").lowercase()
        val candidates = aliases[name] ?: listOf(languageName.trim().removePrefix("language-"))
        return candidates.firstNotNullOfOrNull { Language.findLanguageByID(it) }
    }

    /** The builtin yaml language. */
    fun resolveYaml(): Language? = Language.findLanguageByID("yaml")

    /**
     * EDN front matter: the Clojure language family - EDN is a Clojure
     * subset, so any installed Clojure flavor wins: Cursive ("Clojure"),
     * clojure-lsp-intellij ("clojure"), else the bundled EDN TextMate
     * grammar so the section colors in every IDE.
     */
    fun resolveEdn(): Language? =
        Language.findLanguageByID("Clojure")
            ?: Language.findLanguageByID("clojure")
            ?: Language.findLanguageByID("EDN")
            ?: Language.findLanguageByID("edn")
}
