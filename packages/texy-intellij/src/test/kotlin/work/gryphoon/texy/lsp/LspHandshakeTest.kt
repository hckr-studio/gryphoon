package work.gryphoon.texy.lsp

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.TimeUnit

/**
 * Runs the protocol handshake smoke (lsp-handshake.mjs) against the
 * workspace texy-lsp copy - the same spawn `TexyLspServerDescriptor`
 * performs (node + env + bin/texy-lsp.js). The deep protocol coverage
 * lives in the texy-lsp test suite; this pins the lifecycle and the
 * heading-style env contract the plugin depends on. Skips (assumption
 * failures, not errors) when node or the workspace server copy is absent.
 */
class LspHandshakeTest {

    @Test
    @Timeout(60)
    fun `the server lifecycle passes the handshake smoke with the inline heading style`() {
        runHandshake("inline")
    }

    @Test
    @Timeout(60)
    fun `the default preserve style keeps the underlined heading`() {
        runHandshake("preserve")
    }

    private fun runHandshake(headingStyle: String) {
        val moduleDir = Path.of(System.getProperty("user.dir")).toAbsolutePath()
        val handshake = moduleDir.resolve("lsp-handshake.mjs")
        val script = workspaceServerScript(moduleDir)
        assumeTrue(Files.isRegularFile(handshake), "lsp-handshake.mjs not found in $moduleDir")
        assumeTrue(script != null, "packages/texy-lsp/bin/texy-lsp.js not found above $moduleDir")
        val node = findNodeBinary()
        assumeTrue(node != null, "node not found: install it via Homebrew or nvm, or put it on the IDE's PATH")

        val process = ProcessBuilder(node.toString(), handshake.toString(), script.toString(), headingStyle)
            .directory(moduleDir.toFile())
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.readAllBytes().toString(Charsets.UTF_8)
        assertTrue(process.waitFor(55, TimeUnit.SECONDS), "the handshake smoke did not finish in time")
        assertEquals(0, process.exitValue(), "the handshake smoke failed:\n$output")
        assertTrue("HANDSHAKE PASSED" in output, "the handshake smoke did not report success:\n$output")
    }

    private fun workspaceServerScript(moduleDir: Path): Path? =
        generateSequence(moduleDir) { it.parent }
            .map { it.resolve("packages/texy-lsp/bin/texy-lsp.js") }
            .firstOrNull { Files.isRegularFile(it) }

    /**
     * `node` from PATH first; the Homebrew locations cover IDEs (and
     * Gradle runs) whose PATH lacks the shell-only nvm setup.
     */
    private fun findNodeBinary(): Path? {
        System.getenv("PATH")?.split(File.pathSeparator)?.forEach { dir ->
            val candidate = Paths.get(dir, "node")
            if (Files.isExecutable(candidate)) return candidate
        }
        return sequenceOf(Paths.get("/opt/homebrew/bin/node"), Paths.get("/usr/local/bin/node"))
            .firstOrNull { Files.isExecutable(it) }
    }
}
