package work.gryphoon.texy.lsp

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginAware
import com.intellij.openapi.extensions.PluginDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspIntegrationProvider
import java.nio.file.Path
import work.gryphoon.texy.TexyFileType

/**
 * Starts the Texy language server when a `.texy` file opens; the platform
 * stops/restarts it on project close or server crash.
 */
class TexyLspServerSupportProvider : LspIntegrationProvider, PluginAware {

    // looking the plugin up by id is @ApiStatus.Internal since 2026.2;
    // the platform hands its extensions the descriptor instead
    @Volatile private var pluginPath: Path? = null

    override fun setPluginDescriptor(descriptor: PluginDescriptor) {
        pluginPath = descriptor.pluginPath
    }

    override fun fileOpened(
        project: Project,
        file: VirtualFile,
        clientStarter: LspIntegrationProvider.LspClientStarter,
    ) {
        val isTexyFile = file.fileType === TexyFileType || file.name.endsWith(".texy", ignoreCase = true)
        if (isTexyFile) {
            // Attach even when a stale file-type veto maps .texy to plain text:
            // refactorings, folding and formatting must not depend on the
            // file-type association surviving IDE restarts.
            LOG.info("texy-lsp: fileOpened for ${file.name}, starting server")
            clientStarter.ensureClientStarted(TexyLspServerDescriptor(project, pluginPath))
        }
    }

    companion object {
        private val LOG = Logger.getInstance(TexyLspServerSupportProvider::class.java)
    }
}
