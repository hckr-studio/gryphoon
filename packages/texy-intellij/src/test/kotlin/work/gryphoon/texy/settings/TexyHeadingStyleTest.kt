package work.gryphoon.texy.settings

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * The heading-style enum is the plugin-side half of a contract: the values
 * are what the language server reads from `TEXY_LSP_HEADING_STYLE` and
 * what `TexySettings` persists in `.idea/texy.xml`.
 */
class TexyHeadingStyleTest {

    @Test
    fun `values match the server's TEXY_LSP_HEADING_STYLE strings`() {
        assertEquals(
            listOf("preserve", "inline", "multiline"),
            TexyHeadingStyle.entries.map { it.value },
            "the server falls back to preserve on unknown values, so the keys must stay in sync",
        )
    }

    @Test
    fun `the default keeps each heading's notation`() {
        assertEquals("preserve", TexyHeadingStyle.Preserve.value)
    }
}
