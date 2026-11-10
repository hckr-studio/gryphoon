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
val texyDir = layout.projectDirectory.dir("../texy")

// The bundled @gryphoon/texy copy must carry its own dependency graph
// (linkedom and its transitive deps): outside the monorepo, Node cannot
// resolve them from the plugin dir and the server dies on startup.
// npm resolves the graph into an isolated staging dir - deterministic
// because texy pins its dependencies.
val texyLspDepsStage = layout.buildDirectory.dir("texy-lsp-deps")

val stageTexyLspDeps = tasks.register<Exec>("stageTexyLspDeps") {
    group = "build"
    inputs.dir(texyDir)
    outputs.dir(texyLspDepsStage.map { it.dir("node_modules") })
    doFirst {
        val stage = texyLspDepsStage.get().asFile
        stage.deleteRecursively()
        stage.mkdirs()
        stage.resolve("package.json").writeText(
            """
            {
              "name": "texy-lsp-deps",
              "private": true,
              "type": "module",
              "dependencies": {
                "@gryphoon/texy": "file:${texyDir.asFile.absolutePath}"
              }
            }
            """.trimIndent(),
        )
    }
    workingDir = texyLspDepsStage.get().asFile
    commandLine(
        "npm", "install",
        "--install-links", // file: deps are copied AND their transitive graph installed
        "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock",
        "--loglevel=error",
    )
}

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
    providers.gradleProperty("dump").orNull?.let { path ->
        args(path)
    }
}

tasks.withType<org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask>().configureEach {
    dependsOn(stageTexyLspDeps)
    from(texyLspDir) {
        into("texy-intellij/texy-lsp")
        include("bin/**", "src/**", "package.json")
    }
    from(texyLspDir.dir("node_modules/@gryphoon/texy")) {
        into("texy-intellij/texy-lsp/node_modules/@gryphoon/texy")
        include("package.json", "index.js", "src/**", "LICENSE")
    }
    // @gryphoon/texy's own dependency graph as resolved by npm
    from(texyLspDepsStage) {
        into("texy-intellij/texy-lsp")
        include("node_modules/**")
        exclude("node_modules/@gryphoon/**")
    }

    // PrepareSandbox is a Sync: anything not copied here is wiped from the
    // sandbox plugin dir. Keep the locally installed language plugins the
    // EDN front-matter injection resolves to (clojure-lsp + lsp4ij) alive
    // across re-runs, so the sandbox matches the real IDE.
    for (extra in listOf("clojure-lsp", "lsp4ij")) {
        val dir = file("${System.getProperty("user.home")}/Library/Application Support/JetBrains/WebStorm2026.2/plugins/$extra")
        if (dir.isDirectory) {
            from(dir) { into(extra) }
        }
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