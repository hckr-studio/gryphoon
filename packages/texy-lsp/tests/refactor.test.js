/**
 * Refactoring features over the protocol: the extract refactorings
 * (an inline link/image target becomes a reference use + an appended
 * definition) and prepareRename/rename over both sides of a reference.
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
        // a notification is parked by the waiter itself; only a matching
        // response resolves it and frees the slot
        if (waiters[0](message)) {
          waiters.shift();
        }
        continue;
      }
      notifications.push(message);
    }
  });
  child.stderr.on("data", chunk => process.stderr.write(`[server] ${chunk}`));

  let nextId = 1;
  return {
    child,
    notifications,
    request(method, params) {
      const id = nextId++;
      return this.send({ jsonrpc: "2.0", id, method, params });
    },
    notify(method, params) {
      return this.send({ jsonrpc: "2.0", method, params });
    },
    send(message) {
      return new Promise(resolve => {
        child.stdin.write(frame(message));
        if (message.id !== undefined) {
          const timer = setTimeout(() => resolve(null), 5000);
          waiters.push(response => {
            if (response.id === message.id) {
              clearTimeout(timer);
              resolve(response);
              return true;
            }
            notifications.push(response);
            return false;
          });
        } else {
          resolve(null);
        }
      });
    },
    next(method, { timeoutMs = 5000 } = {}) {
      const index = notifications.findIndex(m => m.method === method);
      if (index !== -1) {
        return Promise.resolve(notifications.splice(index, 1)[0]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
        waiters.push(message => {
          if (message.method === method) {
            clearTimeout(timer);
            resolve(message);
            return true;
          }
          notifications.push(message);
          return false;
        });
      });
    },
    close() {
      child.stdin.end();
      return new Promise(resolve => child.on("exit", resolve));
    },
  };
}

/** Applies WorkspaceEdits (array of TextEdits, whole document) to the text. */
function applyEdits(text, edits) {
  const lines = text.split("\n");
  const toOffset = position => {
    let offset = 0;
    for (let i = 0; i < position.line; i++) {
      offset += lines[i].length + 1;
    }
    return offset + position.character;
  };
  for (const edit of [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))) {
    const from = toOffset(edit.range.start);
    const to = toOffset(edit.range.end);
    text = text.slice(0, from) + edit.newText + text.slice(to);
  }
  return text;
}

describe("refactorings", { timeout: 15000 }, () => {
  const server = startServer();
  let nextVersion = 1;

  before(async () => {
    const response = await server.request("initialize", {
      capabilities: {},
      initializationOptions: { debounceMs: 0 },
    });
    assert.equal(response.result.serverInfo.name, "@gryphoon/texy-lsp");
    await server.notify("initialized", {});
  });
  after(() => server.close());

  async function open(text) {
    const uri = `file:///refactor-${nextVersion++}.texy`;
    await server.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "texy", version: nextVersion, text },
    });
    const { params } = await server.next("textDocument/publishDiagnostics");
    return { uri, text, diagnostics: params.diagnostics };
  }

  it("extracts an inline link target into a reference + appended definition", async () => {
    const doc = `See "Google":https://www.google.com/ search.\n`;
    const { uri } = await open(doc);

    const response = await server.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 10 } },
      context: { only: ["refactor.extract"], triggerKind: 1 },
    });

    const actions = response.result.filter(action => action.kind === "refactor.extract");
    assert.equal(actions.length, 1);
    const [action] = actions;
    assert.match(action.title, /reference "google"/);

    const edits = action.edit.changes[uri];
    assert.equal(edits.length, 2);
    const rewritten = applyEdits(doc, edits);
    assert.equal(
      rewritten,
      `See "Google":[google] search.\n\n[google]: https://www.google.com/\n`,
    );
  });

  it("extracts an inline image target the same way", async () => {
    const doc = `Look [*https://example.com/cat.png*] here.\n`;
    const { uri } = await open(doc);

    const response = await server.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 12 } },
      context: { triggerKind: 1 },
    });

    const [action] = response.result.filter(a => a.kind === "refactor.extract" && /image/.test(a.title));
    assert.ok(action, "image extract action offered");

    const edits = action.edit.changes[uri];
    const rewritten = applyEdits(doc, edits);
    assert.equal(
      rewritten,
      `Look [*example*] here.\n\n[*example*]: https://example.com/cat.png\n`,
    );
  });

  it("extracts a bracketed inline link target (the parser labels it ref)", async () => {
    const doc = `Tlačítkem "Rane MP2015":[https://www.rane.com/mp2015.html] mix.\n`;
    const { uri } = await open(doc);

    const response = await server.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line: 0, character: 30 }, end: { line: 0, character: 36 } },
      context: { triggerKind: 1 },
    });

    const actions = response.result.filter(action => action.kind === "refactor.extract");
    assert.equal(actions.length, 1);
    const rewritten = applyEdits(doc, actions[0].edit.changes[uri]);
    assert.equal(
      rewritten,
      `Tlačítkem "Rane MP2015":[rane] mix.\n\n[rane]: https://www.rane.com/mp2015.html\n`,
    );
  });

  it("offers nothing to extract on a reference use", async () => {
    const doc = `See [gigi] once.\n\n[gigi]: http://www.ggdag.com/\n`;
    const { uri } = await open(doc);

    const response = await server.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } },
      context: { triggerKind: 1 },
    });

    assert.equal(response.result.filter(a => a.kind === "refactor.extract").length, 0);
  });

  it("keeps a second extracted definition tight under the first", async () => {
    const before = `Page "A":https://a.example plus "B":https://b.example end.\n`;
    const { uri } = await open(before);

    const first = await server.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
      context: { triggerKind: 1 },
    });
    const once = applyEdits(before, first.result.find(a => a.kind === "refactor.extract").edit.changes[uri]);
    assert.equal(once, `Page "A":[a] plus "B":https://b.example end.\n\n[a]: https://a.example\n`);

    await server.notify("textDocument/didChange", {
      textDocument: { uri, version: 99 },
      contentChanges: [{ text: once }],
    });
    await server.next("textDocument/publishDiagnostics");

    const second = await server.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line: 0, character: 20 }, end: { line: 0, character: 26 } },
      context: { triggerKind: 1 },
    });
    const twice = applyEdits(once, second.result.find(a => a.kind === "refactor.extract").edit.changes[uri]);
    assert.equal(
      twice,
      `Page "A":[a] plus "B":[b] end.\n\n[a]: https://a.example\n[b]: https://b.example\n`,
    );
  });

  it("renames against the fresh text when the request races the debounce", async () => {
    const uri = `file:///racy-${nextVersion++}.texy`;
    const before = `Link one [alpha] here.\n`;
    await server.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "texy", version: 1, text: before },
    });
    await server.next("textDocument/publishDiagnostics");

    // the client edit and the rename arrive back-to-back, no debounce wait
    const after = `Link one "Alpha":[alpha] plus [beta] there.\n\n[alpha]: https://a.example/\n`;
    await server.notify("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: after }],
    });
    const rename = await server.request("textDocument/rename", {
      textDocument: { uri },
      position: { line: 0, character: 18 },
      newName: "gamma",
    });

    const edits = rename.result.changes[uri].sort((a, b) =>
      (a.range.start.line - b.range.start.line) || (a.range.start.character - b.range.start.character));
    assert.equal(edits.length, 2, "the use in the changed text and the definition are both renamed");
    const applied = applyEdits(after, edits);
    assert.equal(
      applied,
      `Link one "Alpha":[gamma] plus [beta] there.\n\n[gamma]: https://a.example/\n`,
    );
  });

  it("renames a reference at its use and its definition together", async () => {
    const doc = `See "Google":[google] cat.\n\n[google]: https://www.google.com/\n`;
    const { uri } = await open(doc);

    const prepare = await server.request("textDocument/prepareRename", {
      textDocument: { uri },
      position: { line: 0, character: 14 }, // inside "google"
    });
    assert.ok(prepare.result !== null, "rename is offered on a reference use");

    const rename = await server.request("textDocument/rename", {
      textDocument: { uri },
      position: { line: 0, character: 14 },
      newName: "search",
    });

    const edits = rename.result.changes[uri];
    assert.equal(edits.length, 2);
    const applied = applyEdits(doc, edits);
    assert.equal(
      applied,
      `See "Google":[search] cat.\n\n[search]: https://www.google.com/\n`,
    );
  });
});
