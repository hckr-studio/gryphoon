// CLI LSP handshake test: speaks the protocol to the given script and
// asserts the lifecycle replies. Usage: node lsp-handshake.mjs <script.js>
// [headingStyle] - the heading style is passed to the server as
// TEXY_LSP_HEADING_STYLE, exactly like TexyLspServerDescriptor does.
import process from "node:process";
import { spawn } from "node:child_process";

const script = process.argv[2];
const headingStyle = process.argv[3] ?? "inline";
const child = spawn("node", [script], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, TEXY_LSP_HEADING_STYLE: headingStyle },
});

const pending = new Map();
let nextId = 1;
let buffer = Buffer.alloc(0);

function send(method, params, id) {
  const message = id === undefined
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", id, method, params };
  const body = JSON.stringify(message);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send(method, params, id);
  });
}

child.stdout.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString();
    const length = /Content-Length: (\d+)/.exec(header)?.[1];
    if (length === undefined) throw new Error(`bad header: ${header}`);
    const total = headerEnd + 4 + Number(length);
    if (buffer.length < total) return;
    const body = buffer.subarray(headerEnd + 4, total).toString();
    buffer = buffer.subarray(total);
    const message = JSON.parse(body);
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    } else if (message.method === "textDocument/publishDiagnostics") {
      console.log("diagnostics:", JSON.stringify(message.params.diagnostics.map(d => d.message)));
    } else {
      console.log("server message:", JSON.stringify(message));
    }
  }
});

const assert = (condition, what) => { if (!condition) { throw new Error(`FAIL: ${what}`); } else console.log(`ok: ${what}`); };

try {
  const init = await request("initialize", {
    processId: process.pid,
    rootUri: "file:///tmp",
    capabilities: {},
  });
  assert(init.serverInfo?.name === "@gryphoon/texy-lsp", "initialize -> serverInfo");
  assert(init.capabilities?.textDocumentSync?.change === 1, "capabilities: full sync");
  send("initialized", {});

  send("textDocument/didOpen", {
    textDocument: {
      uri: "file:///tmp/sample.texy",
      languageId: "texy",
      version: 1,
      // an underlined heading (level 3: "=" maps to 3 in the levels table)
      text: "Heading\n====\n\nSee [ref] here\n\n[ref]: https://example.com\n",
    },
  });
  await new Promise(r => setTimeout(r, 400));

  const hover = await request("textDocument/hover", {
    textDocument: { uri: "file:///tmp/sample.texy" },
    position: { line: 2, character: 7 },
  });
  // a null hover is a valid server answer; the handshake test cares that the
  // request round-trips without a protocol error, the analysis is covered by
  // the texy-lsp test suite
  console.log(`hover round-tripped: ${JSON.stringify(hover)}`);

  const symbols = await request("textDocument/documentSymbol", {
    textDocument: { uri: "file:///tmp/sample.texy" },
  });
  assert(Array.isArray(symbols) && symbols.length >= 1, `documentSymbol -> ${symbols.length} symbols`);

  // the heading style the server was spawned with, exercised before the
  // didChange below replaces the document with a paragraph-only one
  const headingEdits = await request("textDocument/formatting", {
    textDocument: { uri: "file:///tmp/sample.texy" },
    options: { tabSize: 2, insertSpaces: true },
  });
  assert(Array.isArray(headingEdits), `formatting -> ${JSON.stringify(headingEdits).slice(0, 120)}`);
  if (headingStyle === "inline") {
    const heading = headingEdits.find(e => e.newText === "##### Heading");
    // inline rewrites the underlined heading to its written form
    // (8 - 3 hashes: "=" maps to level 3 in the levels table)
    assert(heading, `the underlined heading converts to the written form -> ${JSON.stringify(headingEdits)}`);
    assert(heading.range.start.line === 0 && heading.range.end.line === 1, "the heading edit covers the title line and the marker line");
  } else if (headingStyle === "preserve") {
    assert(headingEdits.length === 0, `preserve formats nothing in this document -> ${JSON.stringify(headingEdits)}`);
  }

  send("textDocument/didChange", {
    textDocument: { uri: "file:///tmp/sample.texy", version: 2 },
    contentChanges: [{ text: "Foo bar baz,     lorem   ipsum dolor sit  amet set aside consetetur.\n" }],
  });
  await new Promise(r => setTimeout(r, 400));
  const edits = await request("textDocument/formatting", {
    textDocument: { uri: "file:///tmp/sample.texy" },
    options: { tabSize: 2, insertSpaces: true },
  });
  assert(Array.isArray(edits), `formatting -> ${JSON.stringify(edits).slice(0, 120)}`);

  await request("shutdown", null);
  send("exit", null);
  const code = await new Promise(resolve => child.on("exit", resolve));
  assert(code === 0, `server exited with ${code}`);
  console.log("HANDSHAKE PASSED");
  process.exit(0);
} catch (error) {
  console.error("HANDSHAKE FAILED:", error.message);
  child.kill();
  process.exit(1);
}
