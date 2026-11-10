package work.gryphoon.texy.lsp

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServerSupportProvider
import work.gryphoon.texy.TexyFileType

/**
 * Starts the Texy language server when a `.texy` file opens; the platform
 * stops/restarts it on project close or server crash.
 */
class TexyLspServerSupportProvider : LspServerSupportProvider {

    override fun fileOpened(
        project: Project,
        file: VirtualFile,
        starter: LspServerSupportProvider.LspServerStarter,
    ) {
        val isTexyFile = file.fileType === TexyFileType || file.name.endsWith(".texy", ignoreCase = true)
        if (isTexyFile) {
            // Attach even when a stale file-type veto maps .texy to plain text:
            // refactorings, folding and formatting must not depend on the
            // file-type association surviving IDE restarts.
            LOG.info("texy-lsp: fileOpened for ${file.name}, starting server")
            starter.ensureServerStarted(TexyLspServerDescriptor(project))
        }
    }

    companion object {
        private val LOG = Logger.getInstance(TexyLspServerSupportProvider::class.java)
    }
}
