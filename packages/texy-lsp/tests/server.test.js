/**
 * End-to-end protocol test: spawns the real server over stdio pipes,
 * performs the LSP handshake, opens documents (including CRLF sources)
 * and asserts the published diagnostics.
 */

import { describe, it, before, after } from "node:test";
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

  describe("textDocument/definition", { timeout: 5000 }, () => {
    before(async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: "file:///refs.texy",
            languageId: "texy",
            version: 1,
            text: '[home]: https://example.org\n\nsee "click":[home] and [*pic*] and "b":[missing] now\n\n[*pic*]: ./img.png',
          },
        },
      });
      await server.next("textDocument/publishDiagnostics");
    });

    const definitionAt = (id, character, line = 2) =>
      server.send({
        jsonrpc: "2.0",
        id,
        method: "textDocument/definition",
        params: { textDocument: { uri: "file:///refs.texy" }, position: { line, character } },
      });

    it("goes from a link reference use to its definition", async () => {
      const response = await definitionAt(101, 13); // on [home] inside "click":[home]
      assert.deepEqual(response.result, {
        uri: "file:///refs.texy",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 27 } },
      });
    });

    it("goes from an image reference use to its definition", async () => {
      const response = await definitionAt(102, 26); // on [*pic*]
      assert.deepEqual(response.result, {
        uri: "file:///refs.texy",
        range: { start: { line: 4, character: 0 }, end: { line: 4, character: 18 } },
      });
    });

    it("returns null for an undefined reference", async () => {
      const response = await definitionAt(103, 43); // on [missing]
      assert.equal(response.result, null);
    });

    it("returns null off any reference token", async () => {
      const onWord = await definitionAt(104, 0); // "see"
      assert.equal(onWord.result, null);
      const beyondEnd = await definitionAt(105, 200);
      assert.equal(beyondEnd.result, null);
    });

    it("hits on the closing bracket of the token", async () => {
      const response = await definitionAt(106, 17); // the ] of [home]
      assert.deepEqual(response.result.range.start, { line: 0, character: 0 });
    });

    it("bridges CRLF documents", async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: "file:///crlf-refs.texy",
            languageId: "texy",
            version: 1,
            text: "[home]: http://x\r\n\r\n" + '"t":[home]',
          },
        },
      });
      await server.next("textDocument/publishDiagnostics");
      const response = await server.send({
        jsonrpc: "2.0",
        id: 300,
        method: "textDocument/definition",
        params: { textDocument: { uri: "file:///crlf-refs.texy" }, position: { line: 2, character: 5 } },
      });
      assert.deepEqual(response.result, {
        uri: "file:///crlf-refs.texy",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 16 } },
      });
    });
  });

  describe("textDocument/references", { timeout: 5000 }, () => {
    const uri = "file:///many-refs.texy";

    before(async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: "texy",
            version: 1,
            text: "[home]: https://example.org\n\n" + String.raw`"a":[home] first and "b":[home] second`,
          },
        },
      });
      await server.next("textDocument/publishDiagnostics");
    });

    const referencesAt = (id, character, line, includeDeclaration) =>
      server.send({
        jsonrpc: "2.0",
        id,
        method: "textDocument/references",
        params: {
          textDocument: { uri },
          position: { line, character },
          context: { includeDeclaration },
        },
      });

    const location = (line, from, to) => ({
      uri,
      range: { start: { line, character: from }, end: { line, character: to } },
    });

    it("from a use: all uses, plus the declaration when included", async () => {
      const withDecl = await referencesAt(401, 7, 2, true); // on first [home]
      assert.deepEqual(withDecl.result, [location(2, 4, 10), location(2, 25, 31), location(0, 0, 27)]);
    });

    it("from a use: uses only when includeDeclaration is false", async () => {
      const usesOnly = await referencesAt(402, 7, 2, false);
      assert.deepEqual(usesOnly.result, [location(2, 4, 10), location(2, 25, 31)]);
    });

    it("from the definition line: finds every use", async () => {
      const fromDef = await referencesAt(403, 3, 0, true);
      assert.deepEqual(fromDef.result, [location(2, 4, 10), location(2, 25, 31), location(0, 0, 27)]);

      const usesOnly = await referencesAt(404, 3, 0, false);
      assert.deepEqual(usesOnly.result, [location(2, 4, 10), location(2, 25, 31)]);
    });

    it("returns null off any reference", async () => {
      const onWord = await referencesAt(405, 13, 2, true); // "first"
      assert.equal(onWord.result, null);
    });
  });

  describe("textDocument/foldingRange", { timeout: 5000 }, () => {
    const document = [
      "/--code js",
      "line 1",
      "line 2",
      "\\--",
      "",
      "intro text",
      "",
      "> quoted line 1",
      "> quoted line 2",
      "",
      "1) first item",
      "2) second item",
      "   continued",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "| 3 | 4 |",
      "",
      "/--div .(box)",
      "content line",
      "\\--",
      "",
      "single list:",
      "1) only item",
    ].join("\n");

    it("folds multi-line blocks; single-line constructs are omitted", async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: "file:///fold.texy", languageId: "texy", version: 1, text: document } },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await server.send({
        jsonrpc: "2.0",
        id: 500,
        method: "textDocument/foldingRange",
        params: { textDocument: { uri: "file:///fold.texy" } },
      });
      // code block, blockquote, whole list, its multi-line item, table, div;
      // the single-item list (one line) and single-line first items are dropped
      assert.deepEqual(response.result, [
        { startLine: 0, endLine: 3, kind: "region" },
        { startLine: 7, endLine: 8 },
        { startLine: 10, endLine: 12 },
        { startLine: 11, endLine: 12 },
        { startLine: 14, endLine: 17 },
        { startLine: 19, endLine: 21, kind: "region" },
      ]);
    });

    it("reports the same lines for a CRLF document", async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: "file:///fold-crlf.texy", languageId: "texy", version: 1, text: document.replaceAll("\n", "\r\n") } },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await server.send({
        jsonrpc: "2.0",
        id: 501,
        method: "textDocument/foldingRange",
        params: { textDocument: { uri: "file:///fold-crlf.texy" } },
      });
      assert.deepEqual(response.result, [
        { startLine: 0, endLine: 3, kind: "region" },
        { startLine: 7, endLine: 8 },
        { startLine: 10, endLine: 12 },
        { startLine: 11, endLine: 12 },
        { startLine: 14, endLine: 17 },
        { startLine: 19, endLine: 21, kind: "region" },
      ]);
    });
  });

  describe("textDocument/formatting", { timeout: 5000 }, () => {
    const source = [
      "Intro: \"Application Shell\":[https://developer.chrome.com/blog/app-shell] is the pattern we use,",
      "the main script loads modules dynamically according to the current need of the application.",
      "",
      "Title",
      "=====",
      "",
      "## Old ## style ##",
      "",
      "1) aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt",
      "",
      "> quoted aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt",
      "",
      "/--code js",
      "keep   this",
      "  exactly",
      "\\--",
      "",
      "| a |",
      "|---|",
      "| b |",
    ].join("\n") + "\n";

    // the formatter's output for the source above at width 80: the paragraph
    // rewraps with the link token unbroken, both heading styles normalize to
    // the written form (the closing ## run disappears), the list item wraps
    // with continuation indent, the quote re-prefixes, code and table stay
    const formatted = [
      "Intro: \"Application Shell\":[https://developer.chrome.com/blog/app-shell] is the",
      "pattern we use, the main script loads modules dynamically according to the",
      "current need of the application.",
      "",
      "# Title",
      "",
      "## Old ## style",
      "",
      "1) aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss",
      "   ttt",
      "",
      "> quoted aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr",
      "> sss ttt",
      "",
      "/--code js",
      "keep   this",
      "  exactly",
      "\\--",
      "",
      "| a |",
      "|---|",
      "| b |",
    ].join("\n") + "\n";

    /** Applies TextEdits (original coordinates) to a document text. */
    function applyEdits(text, edits) {
      const starts = [0];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") starts.push(i + 1);
      }
      const offset = p => starts[p.line] + p.character;
      let out = text;
      for (const edit of [...edits].sort((x, y) => offset(y.range.start) - offset(x.range.start))) {
        const from = offset(edit.range.start);
        const to = offset(edit.range.end);
        out = out.slice(0, from) + edit.newText + out.slice(to);
      }
      return out;
    }

    const formatRequest = (id, uri) =>
      server.send({ jsonrpc: "2.0", id, method: "textDocument/formatting", params: { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } } });

    it("rewraps paragraphs and normalizes headings; verbatim blocks are untouched", async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: "file:///fmt.texy", languageId: "texy", version: 1, text: source } },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await formatRequest(600, "file:///fmt.texy");
      assert.ok(Array.isArray(response.result) && response.result.length > 0);
      assert.equal(applyEdits(source, response.result), formatted);
    });

    it("edits touch only changed lines, so CRLF endings survive on untouched lines", async () => {
      const crlf = source.replaceAll("\n", "\r\n");
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: "file:///fmt-crlf.texy", languageId: "texy", version: 1, text: crlf } },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await formatRequest(601, "file:///fmt-crlf.texy");
      const applied = applyEdits(crlf, response.result);
      assert.ok(applied.includes("| a |\r\n|---|\r\n")); // untouched lines keep their CRLF
      assert.ok(response.result.every(edit => !edit.newText.includes("\r"))); // replacements are \n-based
      assert.equal(applied.replaceAll("\r\n", "\n"), formatted);
    });

    it("is idempotent: formatting the formatted document yields no edits", async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: { textDocument: { uri: "file:///fmt.texy", version: 2 }, contentChanges: [{ text: formatted }] },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await formatRequest(602, "file:///fmt.texy");
      assert.deepEqual(response.result, []);
    });
  });
});
