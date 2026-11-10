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

    const unknown = await server.send({ jsonrpc: "2.0", id: 2, method: "textDocument/typeDefinition", params: {} });
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

    it("folds paragraphs and definition lists; nested list spans dedupe", async () => {
      const prose = [
        "P1 first line wrapped softly", // 0-2: one soft-wrapped paragraph
        "p1 second line",
        "p1 third line",
        "",
        "term one:", // 4-6: a definition list
        " - description line one",
        " - description line two",
        "",
        "- outer item", // 8-12: a list with a nested list
        "  - inner one", // 9-10: the inner list folds inside
        "  - inner two",
        "  tail of outer item",
        "- second outer item",
      ].join("\n");
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: "file:///fold-prose.texy", languageId: "texy", version: 1, text: prose } },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await server.send({
        jsonrpc: "2.0",
        id: 502,
        method: "textDocument/foldingRange",
        params: { textDocument: { uri: "file:///fold-prose.texy" } },
      });
      assert.deepEqual(response.result, [
        { startLine: 0, endLine: 2 }, // the paragraph
        { startLine: 4, endLine: 6 }, // the definition list
        { startLine: 8, endLine: 12 }, // the outer list
        { startLine: 8, endLine: 11 }, // the outer item (no duplicate of the whole list)
        { startLine: 9, endLine: 10 }, // the inner list
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

    it("never touches the YAML front matter region", async () => {
      const uri = "file:///fm.texy";
      const source = [
        "---",
        "title: A long front matter value that would overflow the wrap width if it were prose",
        "tags: texy, lsp",
        "---",
        "",
        "Post heading",
        "============",
        "",
        "Body paragraph that is quite long so it needs rewrapping when formatted at width 80",
      ].join("\n");
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "texy", version: 1, text: source } },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await formatRequest(603, uri);

      // the front matter (lines 0-3) is data: no edit may start inside it
      assert.ok(response.result.length >= 2); // the heading and the body paragraph still format
      assert.ok(response.result.every(edit => edit.range.start.line >= 4));
      const applied = applyEdits(source, response.result);
      // the whole fence block survives byte-identically
      assert.deepEqual(applied.split("\n").slice(0, 4), [
        "---",
        "title: A long front matter value that would overflow the wrap width if it were prose",
        "tags: texy, lsp",
        "---",
      ]);
      assert.equal(applied.includes("## tags: texy, lsp"), false); // never a heading rewrite of a fence line
      assert.equal(applied.split("\n")[5], "# Post heading"); // the body heading normalizes
    });

    it("a lone --- rule without a closing fence is not front matter", async () => {
      const uri = "file:///nofm.texy";
      const source = "---\nsingle body paragraph long enough to rewrap when formatted at width eighty chars or so";
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "texy", version: 1, text: source } },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await formatRequest(604, uri);
      assert.equal(response.result.length, 1); // the paragraph formats normally
      assert.equal(response.result[0].range.start.line, 1);
    });
  });

  describe("feature probes over one reference document", { timeout: 5000 }, () => {
    const uri = "file:///work/refs-feature.texy";
    const source = [
      "Intro",
      "===",
      "",
      "Second",
      "---",
      "",
      'Some "link":[one] and also [*pic*]',
      "",
      "[one]: https://one.example",
      "[two]: https://two.example",
      "[*pic*]: ./img.png",
    ].join("\n");

    before(async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "texy", version: 1, text: source } },
      });
      await server.next("textDocument/publishDiagnostics");
    });

    const request = (id, method, extra) =>
      server.send({ jsonrpc: "2.0", id, method, params: { textDocument: { uri }, ...extra } });

    it("documentHighlight: uses read, definition write", async () => {
      const onUse = await request(701, "textDocument/documentHighlight", { position: { line: 6, character: 13 } });
      const onDefinition = await request(702, "textDocument/documentHighlight", { position: { line: 8, character: 2 } });
      const expected = [
        { range: { start: { line: 6, character: 12 }, end: { line: 6, character: 17 } }, kind: 2 },
        { range: { start: { line: 8, character: 0 }, end: { line: 8, character: 5 } }, kind: 3 },
      ];
      assert.deepEqual(onUse.result, expected);
      assert.deepEqual(onDefinition.result, expected);

      const off = await request(703, "textDocument/documentHighlight", { position: { line: 6, character: 0 } });
      assert.equal(off.result, null);
    });

    it("documentSymbol: headings nested, definitions as keys", async () => {
      const response = await request(710, "textDocument/documentSymbol", {});
      const intro = response.result[0];
      assert.equal(intro.name, "Intro");
      assert.equal(intro.kind, 15);
      assert.deepEqual(intro.range.start, { line: 0, character: 0 });
      assert.equal(intro.children.length, 1);
      assert.equal(intro.children[0].name, "Second");
      assert.equal(intro.children[0].detail, "H2");

      const definitions = response.result.filter(s => s.kind === 20);
      assert.deepEqual(definitions.map(d => d.name), ["one", "two", "pic"]);
      assert.equal(definitions[0].detail, "https://one.example");
      assert.deepEqual(definitions[0].selectionRange, { start: { line: 8, character: 0 }, end: { line: 8, character: 5 } });
      assert.deepEqual(definitions[2].range, { start: { line: 10, character: 0 }, end: { line: 10, character: 18 } });
    });

    it("hover: resolved targets of use tokens and definitions", async () => {
      const onUse = await request(720, "textDocument/hover", { position: { line: 6, character: 13 } });
      assert.deepEqual(onUse.result.contents, { kind: "markdown", value: "`https://one.example`" });

      const onImage = await request(721, "textDocument/hover", { position: { line: 6, character: 30 } });
      assert.deepEqual(onImage.result.contents, { kind: "markdown", value: "`./img.png`" });

      const onDefinition = await request(722, "textDocument/hover", { position: { line: 8, character: 2 } });
      assert.deepEqual(onDefinition.result.contents, { kind: "markdown", value: "`https://one.example`" });

      const off = await request(723, "textDocument/hover", { position: { line: 6, character: 1 } });
      assert.equal(off.result, null);
    });

    it("inlayHint: the resolved target after each use token", async () => {
      const response = await request(730, "textDocument/inlayHint", {
        range: { start: { line: 0, character: 0 }, end: { line: 11, character: 0 } },
      });
      assert.deepEqual(response.result, [
        { position: { line: 6, character: 17 }, label: "→ https://one.example" },
        { position: { line: 6, character: 34 }, label: "→ ./img.png" },
      ]);
    });

    it("documentLink: uses, definitions, relative targets resolved", async () => {
      const response = await request(740, "textDocument/documentLink", {});
      assert.deepEqual(response.result.map(link => [link.range.start.line, link.range.start.character, link.range.end.character, link.target]), [
        [6, 5, 17, "https://one.example"],
        [6, 27, 34, "file:///work/img.png"],
        [8, 7, 26, "https://one.example"],
        [9, 7, 26, "https://two.example"],
        [10, 9, 18, "file:///work/img.png"],
      ]);
    });

    it("prepareRename + rename: every use and definition, written form kept", async () => {
      const prepare = await request(750, "textDocument/prepareRename", { position: { line: 6, character: 13 } });
      assert.deepEqual(prepare.result, {
        range: { start: { line: 6, character: 12 }, end: { line: 6, character: 17 } },
        placeholder: "one",
      });

      const renamal = await request(751, "textDocument/rename", { position: { line: 8, character: 2 }, newName: "uno" });
      assert.deepEqual(renamal.result.changes[uri].sort((a, b) => a.range.start.line - b.range.start.line), [
        { range: { start: { line: 6, character: 12 }, end: { line: 6, character: 17 } }, newText: "[uno]" },
        { range: { start: { line: 8, character: 0 }, end: { line: 8, character: 5 } }, newText: "[uno]" },
      ]);

      const onImageUse = await request(752, "textDocument/rename", { position: { line: 6, character: 30 }, newName: "grf" });
      assert.deepEqual(onImageUse.result.changes[uri].sort((a, b) => a.range.start.line - b.range.start.line), [
        { range: { start: { line: 6, character: 27 }, end: { line: 6, character: 34 } }, newText: "[*grf*]" },
        { range: { start: { line: 10, character: 0 }, end: { line: 10, character: 7 } }, newText: "[*grf*]" },
      ]);

      const invalid = await request(753, "textDocument/rename", { position: { line: 6, character: 13 }, newName: "bad name" });
      assert.equal(invalid.error.code, -32602);

      const off = await request(754, "textDocument/prepareRename", { position: { line: 0, character: 2 } });
      assert.equal(off.result, null);
    });

    it("selectionRange: innermost to whole document, strictly nesting", async () => {
      const response = await request(760, "textDocument/selectionRange", {
        positions: [{ line: 6, character: 13 }, { line: 9, character: 3 }],
      });
      assert.equal(response.result.length, 2);

      for (const selection of response.result) {
        const chain = [];
        for (let node = selection; node !== null; node = node.parent ?? null) {
          chain.push(node.range);
        }
        assert.ok(chain.length >= 2);
        assert.deepEqual(chain[chain.length - 1].start, { line: 0, character: 0 });
        for (let i = 1; i < chain.length; i++) {
          assert.ok(
            (chain[i].start.line < chain[i - 1].start.line ||
              (chain[i].start.line === chain[i - 1].start.line && chain[i].start.character <= chain[i - 1].start.character)) &&
              (chain[i].end.line > chain[i - 1].end.line ||
                (chain[i].end.line === chain[i - 1].end.line && chain[i].end.character >= chain[i - 1].end.character)),
            `chain entry ${i} must contain the one before it`,
          );
        }
      }

      // the cursor on the [one] token highlights the link node's span first
      const innermost = response.result[0].range;
      assert.ok(innermost.start.line === 6 && innermost.end.line === 6);
    });
  });

  describe("textDocument/completion", { timeout: 5000 }, () => {
    it("completes reference names by prefix inside brackets", async () => {
      const uri = "file:///work/complete.texy";
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: "texy",
            version: 1,
            text: "[one]: https://one.example\n[*pic*]: ./img.png\n\nsee [o",
          },
        },
      });
      await server.next("textDocument/publishDiagnostics");

      const inBracket = await server.send({
        jsonrpc: "2.0",
        id: 770,
        method: "textDocument/completion",
        params: { textDocument: { uri }, position: { line: 3, character: 6 } },
      });
      assert.deepEqual(inBracket.result, [
        {
          label: "one",
          kind: 18,
          detail: "https://one.example",
          textEdit: { range: { start: { line: 3, character: 5 }, end: { line: 3, character: 6 } }, newText: "one" },
        },
      ]);

      const offBracket = await server.send({
        jsonrpc: "2.0",
        id: 771,
        method: "textDocument/completion",
        params: { textDocument: { uri }, position: { line: 0, character: 22 } },
      });
      assert.equal(offBracket.result, null);
    });

    it("completes #toc- heading anchors after the link-target separator", async () => {
      const uri = "file:///work/anchors.texy";
      const doc = "Docs\n===\n\n## Getting started\n\nA link \"jump\":#";
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "texy", version: 1, text: doc } },
      });
      await server.next("textDocument/publishDiagnostics");

      const afterHash = await server.send({
        jsonrpc: "2.0",
        id: 772,
        method: "textDocument/completion",
        params: { textDocument: { uri }, position: { line: 5, character: 15 } },
      });
      assert.deepEqual(afterHash.result, [
        {
          label: "toc-docs",
          kind: 18,
          detail: "Docs",
          textEdit: { range: { start: { line: 5, character: 14 }, end: { line: 5, character: 15 } }, newText: "#toc-docs" },
        },
        {
          label: "toc-getting-started",
          kind: 18,
          detail: "Getting started",
          textEdit: { range: { start: { line: 5, character: 14 }, end: { line: 5, character: 15 } }, newText: "#toc-getting-started" },
        },
      ]);

      // with a typed prefix the list narrows, and the edit replaces the
      // whole partial anchor token
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: "Docs\n===\n\n## Getting started\n\nA link \"jump\":#toc-ge" }] },
      });
      await server.next("textDocument/publishDiagnostics");
      const withPrefix = await server.send({
        jsonrpc: "2.0",
        id: 773,
        method: "textDocument/completion",
        params: { textDocument: { uri }, position: { line: 5, character: 21 } },
      });
      assert.deepEqual(withPrefix.result, [
        {
          label: "toc-getting-started",
          kind: 18,
          detail: "Getting started",
          textEdit: { range: { start: { line: 5, character: 14 }, end: { line: 5, character: 21 } }, newText: "#toc-getting-started" },
        },
      ]);

      const noMatch = await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: { textDocument: { uri, version: 3 }, contentChanges: [{ text: "Docs\n===\n\n## Getting started\n\nA link \"jump\":#toc-nop" }] },
      });
      assert.equal(noMatch, null);
      await server.next("textDocument/publishDiagnostics");
      const empty = await server.send({
        jsonrpc: "2.0",
        id: 774,
        method: "textDocument/completion",
        params: { textDocument: { uri }, position: { line: 5, character: 24 } },
      });
      assert.deepEqual(empty.result, []);

      // a heading marker at line start is not a link target
      const onHeading = await server.send({
        jsonrpc: "2.0",
        id: 775,
        method: "textDocument/completion",
        params: { textDocument: { uri }, position: { line: 3, character: 3 } },
      });
      assert.equal(onHeading.result, null);
    });
  });

  describe("textDocument/codeAction", { timeout: 5000 }, () => {
    const uri = "file:///work/hostile.texy";
    const source = "broken <b>text\n\nsee \"x\":[nope]\n\nstray </i> here";

    before(async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "texy", version: 1, text: source } },
      });
      await server.next("textDocument/publishDiagnostics");
    });

    /** Applies TextEdits to a document text. */
    const applyEdits = text => {
      const starts = [0];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") starts.push(i + 1);
      }
      const at = p => starts[p.line] + p.character;
      return edits => {
        let out = text;
        for (const edit of [...edits].sort((x, y) => at(y.range.start) - at(x.range.start))) {
          out = out.slice(0, at(edit.range.start)) + edit.newText + out.slice(at(edit.range.end));
        }
        return out;
      };
    };

    const codeAction = id =>
      server.send({
        jsonrpc: "2.0",
        id,
        method: "textDocument/codeAction",
        params: {
          textDocument: { uri },
          range: { start: { line: 0, character: 0 }, end: { line: 4, character: 15 } },
          context: { diagnostics: [] },
        },
      });

    it("offers a quick fix per lint issue with exact edits", async () => {
      const response = await codeAction(780);
      const titles = response.result.map(action => action.title).sort();
      assert.deepEqual(titles, ['Define reference "nope"', "Delete stray </i>", "Insert </b>"]);

      const byTitle = title => response.result.find(action => action.title === title);
      assert.ok(response.result.every(action => action.kind === "quickfix" && action.diagnostics.length === 1));

      const closed = applyEdits(source)(byTitle("Insert </b>").edit.changes[uri]);
      assert.ok(closed.includes("broken <b>text</b>"));

      const defined = applyEdits(source)(byTitle('Define reference "nope"').edit.changes[uri]);
      assert.ok(defined.endsWith("\n\n[nope]: https://"));

      const deleted = applyEdits(source)(byTitle("Delete stray </i>").edit.changes[uri]);
      assert.ok(deleted.includes("stray  here"));
    });

    it("range filtering: only the issues inside the requested range", async () => {
      const response = await server.send({
        jsonrpc: "2.0",
        id: 781,
        method: "textDocument/codeAction",
        params: {
          textDocument: { uri },
          range: { start: { line: 4, character: 0 }, end: { line: 4, character: 15 } },
          context: { diagnostics: [] },
        },
      });
      assert.deepEqual(response.result.map(action => action.title), ["Delete stray </i>"]);
    });
  });

  describe("quick fix: escaping a rejected tag", { timeout: 5000 }, () => {
    it("replaces the tag with the text it would render as", async () => {
      const uri = "file:///work/rejected.texy";
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "texy", version: 1, text: "fun <marquee>wheee</marquee>" } },
      });
      await server.next("textDocument/publishDiagnostics");

      const response = await server.send({
        jsonrpc: "2.0",
        id: 782,
        method: "textDocument/codeAction",
        params: {
          textDocument: { uri },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 26 } },
          context: { diagnostics: [] },
        },
      });
      const escapes = response.result.filter(action => action.title === "Escape <marquee> to text");
      assert.ok(escapes.length > 0);
      const edits = escapes.flatMap(action => action.edit.changes[uri]).sort((a, b) => a.range.start.character - b.range.start.character);
      assert.ok(edits.every(edit => !edit.newText.includes("<")));
    });
  });

  describe("reference-health diagnostics", { timeout: 5000 }, () => {
    it("unused definition", async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: "file:///work/unused.texy",
            languageId: "texy",
            version: 1,
            text: "[one]: https://one\n[two]: https://two\n\nsee \"x\":[one]",
          },
        },
      });
      const { params } = await server.next("textDocument/publishDiagnostics");
      const unused = params.diagnostics.filter(d => d.code === "reference/unused");
      assert.equal(unused.length, 1);
      assert.equal(unused[0].severity, 4);
      assert.ok(unused[0].message.includes("never used"));
      assert.deepEqual(unused[0].range.start, { line: 1, character: 0 });
    });

    it("duplicate definition (the last one wins)", async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: "file:///work/duplicate.texy", languageId: "texy", version: 1, text: '[one]: https://first\n[one]: https://second\n\nsee "x":[one]' } },
      });
      const { params } = await server.next("textDocument/publishDiagnostics");
      const duplicate = params.diagnostics.filter(d => d.code === "reference/duplicate");
      assert.equal(duplicate.length, 1);
      assert.equal(duplicate[0].severity, 2);
      assert.deepEqual(duplicate[0].range.start, { line: 1, character: 0 });
    });
  });

  describe("textDocument/rangeFormatting", { timeout: 5000 }, () => {
    const uri = "file:///work/rangefmt.texy";
    const paragraph = "paragraph aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt";
    const source = `${paragraph}\n\nTitle\n=====`;

    it("formats only the blocks overlapping the range", async () => {
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "texy", version: 1, text: source } },
      });
      await server.next("textDocument/publishDiagnostics");

      const ranged = await server.send({
        jsonrpc: "2.0",
        id: 790,
        method: "textDocument/rangeFormatting",
        params: {
          textDocument: { uri },
          range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
          options: { tabSize: 4, insertSpaces: true },
        },
      });
      assert.equal(ranged.result.length, 1); // the paragraph only, not the heading
      assert.equal(ranged.result[0].range.start.line, 0);
      assert.ok(ranged.result[0].newText.includes("\n")); // it rewraps

      const full = await server.send({
        jsonrpc: "2.0",
        id: 791,
        method: "textDocument/formatting",
        params: { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } },
      });
      assert.equal(full.result.length, 2);
      assert.deepEqual(ranged.result[0], full.result.find(edit => edit.range.start.line === 0));
    });
  });

  describe("workspace/didChangeConfiguration", { timeout: 5000 }, () => {
    it("lineWidth is honored by formatting and can be restored", async () => {
      const uri = "file:///work/config.texy";
      await server.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: "texy",
            version: 1,
            text: "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss",
          },
        },
      });
      await server.next("textDocument/publishDiagnostics");

      await server.send({
        jsonrpc: "2.0",
        method: "workspace/didChangeConfiguration",
        params: { settings: { texy: { lineWidth: 40 } } },
      });

      const response = await server.send({
        jsonrpc: "2.0",
        id: 795,
        method: "textDocument/formatting",
        params: { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } },
      });
      assert.equal(response.result.length, 1);
      assert.ok(response.result[0].newText.split("\n").every(line => line.length <= 40));

      // restore, so later requests of other documents see the default again
      await server.send({
        jsonrpc: "2.0",
        method: "workspace/didChangeConfiguration",
        params: { settings: { texy: { lineWidth: 80 } } },
      });
      const restored = await server.send({
        jsonrpc: "2.0",
        id: 796,
        method: "textDocument/formatting",
        params: { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } },
      });
      assert.deepEqual(restored.result, []);
    });
  });
});
