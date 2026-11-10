package work.gryphoon.texy.lsp

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
        if (file.fileType === TexyFileType) {
            starter.ensureServerStarted(TexyLspServerDescriptor(project))
        }
    }
}
