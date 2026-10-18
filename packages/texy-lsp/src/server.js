/**
 * The Texy! language server: LSP lifecycle + text document
 * synchronization over any byte streams, and diagnostics as the first
 * feature - @gryphoon/texy parses and lints in one pass, and issue
 * ranges are bridged from the parser's normalized coordinate space back
 * to the document as the client sent it.
 *
 * Protocol error codes are JSON-RPC 2.0 reserved codes.
 */

import { Texy } from "@gryphoon/texy/Texy.js";
import { normalizeWithMap } from "@gryphoon/texy/normalize.js";
import { createMessageReader, writeMessage } from "./framing.js";
import { DocumentStore } from "./documents.js";
import { toLspRange } from "./positions.js";

const MethodNotFound = -32601;
const InternalError = -32603;

export class TexyLanguageServer {
  /**
   * @param {Object} [options]
   * @param {Texy} [options.texy]
   * @param {number} [options.debounceMs] didChange analysis delay
   * @param {(code: number) => void} [options.onExit] exit hook, process.exit by default
   */
  constructor({ texy = null, debounceMs = 150, onExit = code => process.exit(code) } = {}) {
    this.texy = texy ?? new Texy();
    this.debounceMs = debounceMs;
    this.onExit = onExit;
    this.store = new DocumentStore();
    this.shutdownReceived = false;

    /** @type {?import("node:stream").Writable} */
    this.writer = null;
    /** @type {Map<string, import("node:timers").Timeout>} pending analysis per uri */
    this.pending = new Map();
  }

  /**
   * Connects the server to its streams and starts dispatching messages.
   * @param {import("node:stream").Readable} input
   * @param {import("node:stream").Writable} output
   */
  attach(input, output) {
    this.writer = output;
    createMessageReader(input, message => this.receive(message));
  }

  /** @param {Object} message a JSON-RPC request, response or notification */
  receive(message) {
    if ((message.id !== undefined && message.id !== null) && message.method !== undefined) {
      this.handleRequest(message);
    } else if (message.method !== undefined) {
      this.handleNotification(message);
    }
    // responses from the client (none are pending) are ignored
  }

  /**
   * @param {Object} message
   * @param {string|number} message.id
   * @param {string} message.method
   * @param {Object} [message.params]
   */
  handleRequest(message) {
    // dispatch runs inside the chain so a synchronous throw (unknown
    // method) becomes an error response instead of an uncaught exception
    Promise.resolve()
      .then(() => this.dispatch(message.method, message.params))
      .then(result => this.reply(message.id, { result: result ?? null }))
      .catch(error => {
        const code = error.code ?? InternalError;
        this.reply(message.id, { error: { code, message: error.message } });
      });
  }

  /** @param {string|number} id @param {Object} payload result or error envelope */
  reply(id, payload) {
    this.send({ jsonrpc: "2.0", id, ...payload });
  }

  /** @param {Object} message */
  send(message) {
    if (this.writer !== null) {
      writeMessage(this.writer, message);
    }
  }

  /**
   * @param {string} method
   * @param {Object} [params]
   * @returns {Object|null|Promise<Object|null>}
   */
  dispatch(method, params) {
    switch (method) {
      case "initialize":
        return this.initialize(params ?? {});
      case "shutdown":
        this.shutdownReceived = true;
        return null;
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: MethodNotFound });
    }
  }

  /** @param {Object} message */
  handleNotification(message) {
    const params = message.params ?? {};
    switch (message.method) {
      case "initialized":
        break;
      case "exit":
        this.onExit(this.shutdownReceived ? 0 : 1);
        break;
      case "textDocument/didOpen":
        this.didOpen(params);
        break;
      case "textDocument/didChange":
        this.didChange(params);
        break;
      case "textDocument/didClose":
        this.didClose(params);
        break;
      default:
        break; // unknown notifications are ignored per the spec
    }
  }

  /**
   * @param {Object} params
   * @param {Object} [params.initializationOptions]
   */
  initialize(params) {
    const options = params.initializationOptions ?? {};
    if (options.debounceMs !== undefined) {
      this.debounceMs = options.debounceMs;
    }

    return {
      capabilities: {
        positionEncoding: "utf-16",
        textDocumentSync: {
          openClose: true,
          change: 1, // full-document sync
        },
      },
      serverInfo: { name: "@gryphoon/texy-lsp", version: "0.1.0" },
    };
  }

  /** @param {Object} params textDocument/didOpen */
  didOpen(params) {
    const doc = params.textDocument ?? {};
    this.store.open(doc.uri, doc.languageId ?? "texy", doc.version ?? 0, doc.text ?? "");
    this.analyze(doc.uri);
  }

  /** @param {Object} params textDocument/didChange (full sync) */
  didChange(params) {
    const uri = params.textDocument?.uri;
    const document = this.store.get(uri);
    if (document === null) {
      return;
    }
    if (params.textDocument?.version !== undefined) {
      document.version = params.textDocument.version;
    }

    const changes = params.contentChanges ?? [];
    if (changes.length > 0) {
      document.setText(changes[changes.length - 1].text ?? "");
    }

    clearTimeout(this.pending.get(uri));
    this.pending.set(
      uri,
      setTimeout(() => {
        this.pending.delete(uri);
        this.analyze(uri);
      }, this.debounceMs),
    );
  }

  /** @param {Object} params textDocument/didClose */
  didClose(params) {
    const uri = params.textDocument?.uri;
    clearTimeout(this.pending.get(uri));
    this.pending.delete(uri);
    this.store.close(uri);
    this.send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
  }

  /**
   * Parses + lints the document and publishes the diagnostics in the
   * original document's coordinates.
   * @param {string} uri
   */
  analyze(uri) {
    const document = this.store.get(uri);
    if (document === null) {
      return;
    }

    const { text, map } = normalizeWithMap(document.text);
    const { issues } = this.texy.lint(text); // parse() re-normalizes, idempotently

    this.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        diagnostics: issues.map(issue => ({
          range: toLspRange(issue.range, map, document.lineStarts),
          severity: issue.severity,
          code: issue.code ?? undefined,
          source: "texy",
          message: issue.message,
        })),
      },
    });
  }
}
