plugins {
    id("org.jetbrains.kotlin.jvm") version "2.4.0"
    id("org.jetbrains.intellij.platform") version "2.20.1"
}

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        // compile and run the sandbox against the locally installed WebStorm 2026.3;
        // the IDE home on macOS is the .app bundle's Contents directory
        local("/Users/rarous/Applications/WebStorm.app/Contents")
    }
}

java {
    // the build runs on the JBR bundled with the local WebStorm 2026.3
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
        vendor.set(org.gradle.jvm.toolchain.JvmVendorSpec.JETBRAINS)
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// texy-lsp ships as plain ES modules; bundle it next to the plugin jar so the
// LSP descriptor can spawn `node texy-lsp/bin/texy-lsp.js` from the plugin dir
val texyLspDir = layout.projectDirectory.dir("../texy-lsp")

intellijPlatform {
    pluginVerification {
        ides {
            create("WS", "2026.3")
            create("WS", "2025.2")
        }
    }
}

tasks.register<JavaExec>("lexSmoke") {
    group = "verification"
    // 2.x attaches the platform to the test *compile* classpath only;
    // a plain run needs the platform class added explicitly
    classpath(
        sourceSets["test"].runtimeClasspath,
        configurations["intellijPlatformTestClasspath"],
    )
    mainClass.set("work.gryphoon.texy.LexerSmokeKt")
}

tasks.withType<org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask>().configureEach {
    from(texyLspDir) {
        into("texy-intellij/texy-lsp")
        include("bin/**", "src/**", "package.json")
    }
    from(texyLspDir.dir("node_modules/@gryphoon/texy")) {
        into("texy-intellij/texy-lsp/node_modules/@gryphoon/texy")
        include("package.json", "index.js", "src/**", "LICENSE")
    }
}

tasks {
    patchPluginXml {
        sinceBuild.set("242")
        untilBuild.set("")
    }
    buildSearchableOptions {
        enabled = false
    }
}