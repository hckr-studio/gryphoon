plugins {
    id("org.jetbrains.kotlin.jvm") version "2.2.0"
    id("org.jetbrains.intellij") version "1.17.4"
}

repositories {
    mavenCentral()
}

intellij {
    // Compile against the Community platform; the plugin uses no WebStorm-specific
    // APIs, so the artifact runs in WebStorm (and other IntelliJ-based IDEs).
    version.set("2025.2")
    type.set("IC")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

tasks.register<JavaExec>("lexSmoke") {
    group = "verification"
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("work.gryphoon.texy.LexerSmokeKt")
}

tasks {
    patchPluginXml {
        sinceBuild.set("242")
        untilBuild.set("")
    }
    buildSearchableOptions {
        enabled = false
    }
    runPluginVerifier {
        ideVersions.set(listOf("WS-2026.3", "WS-2025.2"))
        failureLevel.set(listOf(org.jetbrains.intellij.tasks.RunPluginVerifierTask.FailureLevel.INVALID_PLUGIN))
    }
}
