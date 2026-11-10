package work.gryphoon.texy.lsp

import com.intellij.execution.ExecutionException
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServerDescriptor
import work.gryphoon.texy.TexyFileType
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * The Texy language server session: spawns `node bin/texy-lsp.js` and serves
 * the features the server advertises (diagnostics, definition/references,
 * symbols, folding, completion, hover, inlays, links, quick fixes, rename,
 * formatting). The plugin's lexer/parser keep syntax highlighting; the
 * server owns semantic analysis.
 *
 * The server script is resolved from the monorepo checkout first (so a
 * workspace dev copy wins over the bundled one), then from the copy bundled
 * with the plugin.
 */
class TexyLspServerDescriptor(project: Project) : LspServerDescriptor(project, "Texy") {

    override fun isSupportedFile(file: VirtualFile): Boolean = isTexyFile(file)

    /**
     * Matches on the file extension, not the file type: a stale
     * `removed_mapping` veto in the IDE config can map `.texy` to plain text
     * while the file is open, which must not disconnect it from the server.
     */
    private fun isTexyFile(file: VirtualFile): Boolean =
        file.fileType === TexyFileType || file.name.endsWith(".texy", ignoreCase = true)

    /**
     * Texy has no IntelliJ-side formatter; reformatting (whole file and
     * selection) goes exclusively to the language server, which advertises
     * textDocument/formatting and textDocument/rangeFormatting. Rename
     * (prepareRename/rename) dispatches too - the default only allows
     * TEXT/textmate files.
     */
    override val lspCustomization: com.intellij.platform.lsp.api.customization.LspCustomization
        get() = object : com.intellij.platform.lsp.api.customization.LspCustomization() {
            override val formattingCustomizer: com.intellij.platform.lsp.api.customization.LspFormattingCustomizer
                get() = object : com.intellij.platform.lsp.api.customization.LspFormattingSupport() {
                    override fun shouldFormatThisFileExclusivelyByServer(
                        file: VirtualFile,
                        isWholeFile: Boolean,
                        isRange: Boolean,
                    ): Boolean = true
                }

            override val renameCustomizer: com.intellij.platform.lsp.api.customization.LspRenameCustomizer
                get() = object : com.intellij.platform.lsp.api.customization.LspRenameSupport() {
                    override fun shouldRunRename(psiFile: com.intellij.psi.PsiFile): Boolean =
                        psiFile.fileType === TexyFileType ||
                            psiFile.name.endsWith(".texy", ignoreCase = true)
                }
        }

    override fun createCommandLine(): GeneralCommandLine {
        val script = findServerScript()
            ?: throw ExecutionException(
                "texy-lsp not found: neither packages/texy-lsp nor the plugin-bundled copy is present"
            )
        val node = findNodeBinary()
            ?: throw ExecutionException(
                "node not found: install it via Homebrew or nvm, or put it on the IDE's PATH"
            )
        LOG.info("texy-lsp: spawning node with $script")
        val command = GeneralCommandLine(node.toString(), script.toString())
        project.basePath?.let { command.withWorkDirectory(it) }
        command.charset = Charsets.UTF_8
        // protocol trace: one file per session, fresh on every server start
        command.withEnvironment(
            "TEXY_LSP_TRACE",
            Paths.get(System.getProperty("java.io.tmpdir"), "texy-lsp-trace.log").toString(),
        )
        return command
    }

    private fun findServerScript(): Path? {
        val workspaceScript = project.basePath
            ?.let { Paths.get(it, "packages", "texy-lsp", "bin", "texy-lsp.js") }
        return sequenceOf(workspaceScript, bundledScript())
            .filterNotNull()
            .firstOrNull { Files.isRegularFile(it) }
    }

    private fun bundledScript(): Path? {
        val plugin = com.intellij.ide.plugins.PluginManagerCore.getPlugin(
            com.intellij.openapi.extensions.PluginId.getId("work.gryphoon.texy")
        ) ?: return null
        return plugin.pluginPath?.resolve("texy-lsp/bin/texy-lsp.js")
    }

    /**
     * `node` from PATH first; the nvm and Homebrew locations cover IDEs
     * launched from Toolbox, whose PATH lacks the shell-only nvm setup.
     */
    private fun findNodeBinary(): Path? {
        System.getenv("PATH")?.split(File.pathSeparator)?.forEach { dir ->
            val candidate = Paths.get(dir, "node")
            if (Files.isExecutable(candidate)) return candidate
        }
        val fallbacks = sequenceOf(
            Paths.get("/opt/homebrew/bin/node"),
            Paths.get("/usr/local/bin/node"),
        )
        fallbacks.firstOrNull { Files.isExecutable(it) }?.let { return it }
        val nvmDir = Paths.get(System.getProperty("user.home"), ".nvm", "versions", "node")
        return nvmDir.takeIf { Files.isDirectory(it) }
            ?.listChildren()
            ?.map { it.resolve("bin/node") }
            ?.filter { Files.isExecutable(it) }
            ?.maxByOrNull { it.toString() }
    }

    private fun Path.listChildren(): List<Path> =
        Files.list(this).use { it.toList() }

    companion object {
        private val LOG = com.intellij.openapi.diagnostic.Logger.getInstance(TexyLspServerDescriptor::class.java)
    }
}
