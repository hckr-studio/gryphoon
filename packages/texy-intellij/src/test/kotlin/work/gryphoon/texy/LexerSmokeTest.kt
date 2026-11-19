package work.gryphoon.texy

import org.junit.jupiter.api.Test

/**
 * The lexer smoke as a JUnit test: exact buffer tiling, token
 * classification and state transitions of a representative document,
 * front matter included (see [LexerSmoke] for the checks).
 */
class LexerSmokeTest {

    @Test
    fun `representative document tiles exactly and classifies tokens`() {
        LexerSmoke.check()
    }
}
