plugins {
    id("org.jetbrains.kotlin.jvm") version "2.4.0"
    id("org.jetbrains.intellij") version "1.17.4"
}

repositories {
    mavenCentral()
}

intellij {
    // Compile and run the sandbox against the locally installed WebStorm.
    // The IDE home on macOS is the .app bundle's Contents directory.
    localPath.set("/Users/rarous/Applications/WebStorm.app/Contents")
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

// gradle-intellij 1.x cannot parse the 2026.3 product-info.json launch layout,
// so runIde crashes; launch the locally installed WebStorm against the sandbox instead.
tasks.register<Exec>("runWebStormSandbox") {
    group = "intellij"
    description = "Launches the locally installed WebStorm against the Gradle sandbox with the plugin installed."
    dependsOn("prepareSandbox")
    val sandbox = layout.projectDirectory.dir("build/idea-sandbox")
    commandLine(
        "/Users/rarous/Applications/WebStorm.app/Contents/MacOS/webstorm",
        "-Didea.config.path=${sandbox}/config",
        "-Didea.system.path=${sandbox}/system",
        "-Didea.plugins.path=${sandbox}/plugins",
        "-Didea.log.path=${sandbox}/log",
    )
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
