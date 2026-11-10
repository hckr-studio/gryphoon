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

    override fun isSupportedFile(file: VirtualFile): Boolean = file.fileType === TexyFileType

    override fun createCommandLine(): GeneralCommandLine {
        val script = findServerScript()
            ?: throw ExecutionException(
                "texy-lsp not found: neither packages/texy-lsp nor the plugin-bundled copy is present"
            )
        val node = findNodeBinary()
            ?: throw ExecutionException(
                "node not found: install it via Homebrew or nvm, or put it on the IDE's PATH"
            )
        val command = GeneralCommandLine(node.toString(), script.toString())
        project.basePath?.let { command.withWorkDirectory(it) }
        command.charset = Charsets.UTF_8
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
}
