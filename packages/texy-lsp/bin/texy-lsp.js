#!/usr/bin/env node
/**
 * Language server for the Texy! markup language: JSON-RPC over stdio.
 * Launch from any LSP client, e.g. VS Code's LanguageClient.
 *
 * TEXY_LSP_TRACE=<file> logs every protocol message (with long strings
 * elided) to the file, truncated at each session start - the hook for
 * diagnosing which gestures reach the server at all.
 */

import process from "node:process";
import fs from "node:fs";
import { TexyLanguageServer } from "../src/server.js";

const server = new TexyLanguageServer();

if (process.env.TEXY_LSP_TRACE) {
  const trace = process.env.TEXY_LSP_TRACE;
  fs.writeFileSync(trace, `texy-lsp trace ${new Date().toISOString()}\n`);
  const elide = message =>
    JSON.stringify(message, (key, value) =>
      typeof value === "string" && value.length > 200 ? `<${value.length} chars>` : value);
  server.onTrace = (direction, message) => {
    fs.appendFileSync(trace, `${direction} ${elide(message)}\n`);
  };
}

server.attach(process.stdin, process.stdout);

// a closed input pipe ends the session even without shutdown/exit
process.stdin.on("end", () => process.exit(server.shutdownReceived ? 0 : 0));
