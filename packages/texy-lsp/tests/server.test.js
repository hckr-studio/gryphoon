/**
 * End-to-end protocol test: spawns the real server over stdio pipes,
 * performs the LSP handshake, opens documents (including CRLF sources)
 * and asserts the published diagnostics.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const bin = join(dirname(dirname(fileURLToPath(import.meta.url))), "bin", "texy-lsp.js");

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

/** A scriptable client over the spawned server. */
function startServer() {
  const child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "pipe"] });
  const notifications = [];
  const waiters = [];

  let buffer = Buffer.alloc(0);
  child.stdout.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const sep = buffer.indexOf("\r\n\r\n");
      if (sep === -1) break;
      const length = Number(buffer.subarray(0, sep).toString("latin1").match(/Content-Length:\s*(\d+)/i)[1]);
      if (buffer.length < sep + 4 + length) break;
      const message = JSON.parse(buffer.subarray(sep + 4, sep + 4 + length).toString("utf8"));
      buffer = buffer.subarray(sep + 4 + length);
      if (waiters.length > 0) {
        waiters.shift()(message);
      } else {
        notifications.push(message);
      }
    }
  });
  child.stderr.on("data", chunk => process.stderr.write(`[server] ${chunk}`));

  return {
    child,
    notifications,
    /** Sends a message; for requests, resolves with the matching response. */
    send(message) {
      return new Promise(resolve => {
        child.stdin.write(frame(message));
        if (message.id !== undefined) {
          waiters.push(response => (response.id === message.id ? resolve(response) : (notifications.push(response), resolve(null))));
        } else {
          resolve(null);
        }
      });
    },
    /** Resolves with the next notification of the given method. */
    next(method, { timeoutMs = 5000 } = {}) {
      const index = notifications.findIndex(m => m.method === method);
      if (index !== -1) {
        return Promise.resolve(notifications.splice(index, 1)[0]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
        waiters.push(message => {
          clearTimeout(timer);
          if (message.method === method) {
            resolve(message);
          } else {
            notifications.push(message);
          }
        });
      });
    },
    close() {
      child.stdin.end();
      return new Promise(resolve => child.on("exit", resolve));
    },
  };
}

describe("texy-lsp over stdio", { timeout: 15000 }, () => {
  const server = startServer();
  after(() => server.close());

  it("handshake: initialize reports capabilities, shutdown/exit terminates", { timeout: 5000 }, async () => {
    const response = await server.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {}, initializationOptions: { debounceMs: 0 } },
    });
    assert.equal(response.result.capabilities.textDocumentSync.change, 1);
    assert.equal(response.result.serverInfo.name, "@gryphoon/texy-lsp");

    const unknown = await server.send({ jsonrpc: "2.0", id: 2, method: "textDocument/hover", params: {} });
    assert.equal(unknown.error.code, -32601); // MethodNotFound

    const shutdown = await server.send({ jsonrpc: "2.0", id: 3, method: "shutdown", params: null });
    assert.equal(shutdown.result, null);
  });

  it("publishes diagnostics with ranges in the original document", { timeout: 5000 }, async () => {
    await server.send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri: "file:///plain.texy", languageId: "texy", version: 1, text: "hello <b>world" } },
    });

    const { params } = await server.next("textDocument/publishDiagnostics");
    assert.equal(params.uri, "file:///plain.texy");
    assert.equal(params.diagnostics.length, 1);
    const [diagnostic] = params.diagnostics;
    assert.equal(diagnostic.source, "texy");
    assert.equal(diagnostic.code, "html/tag-unclosed");
    assert.deepEqual(diagnostic.range, { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } });
  });

  it("bridges normalization: CRLF document ranges land on the original text", { timeout: 5000 }, async () => {
    await server.send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri: "file:///crlf.texy", languageId: "texy", version: 1, text: "first\r\n\r\n<b>bold" },
      },
    });

    const { params } = await server.next("textDocument/publishDiagnostics");
    const [diagnostic] = params.diagnostics;
    assert.equal(diagnostic.code, "html/tag-unclosed");
    // original text: line 2 starts at 7; "<b>" begins at offset 9
    assert.deepEqual(diagnostic.range, { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } });
  });

  it("didChange republishes and didClose clears the diagnostics", { timeout: 5000 }, async () => {
    const uri = "file:///edit.texy";
    await server.send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "texy", version: 1, text: "broken <i>text" } },
    });
    const broken = await server.next("textDocument/publishDiagnostics");
    assert.equal(broken.params.diagnostics.length, 1);

    await server.send({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: "fixed **text**" }] },
    });
    const fixed = await server.next("textDocument/publishDiagnostics");
    assert.deepEqual(fixed.params.diagnostics, []);

    await server.send({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } });
    const cleared = await server.next("textDocument/publishDiagnostics");
    assert.deepEqual(cleared.params.diagnostics, []);
  });
});
