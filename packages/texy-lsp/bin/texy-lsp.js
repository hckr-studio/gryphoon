#!/usr/bin/env node
/**
 * Language server for the Texy! markup language: JSON-RPC over stdio.
 * Launch from any LSP client, e.g. VS Code's LanguageClient.
 */

import process from "node:process";
import { TexyLanguageServer } from "../src/server.js";

const server = new TexyLanguageServer();
server.attach(process.stdin, process.stdout);

// a closed input pipe ends the session even without shutdown/exit
process.stdin.on("end", () => process.exit(server.shutdownReceived ? 0 : 0));
