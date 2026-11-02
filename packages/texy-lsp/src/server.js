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
import { offsetAt, normalizedOffsetAt, positionAt, toLspRange } from "./positions.js";
import { collectReferences, refTokenRange } from "./links.js";
import { collectFoldings, toFoldingRanges } from "./folding.js";
import { formatDocument } from "./formatting.js";

const MethodNotFound = -32601;
const InternalError = -32603;

export class TexyLanguageServer {
  /**
   * @param {Object} [options]
   * @param {Texy} [options.texy]
   * @param {number} [options.debounceMs] didChange analysis delay
   * @param {(code: number) => void} [options.onExit] exit hook, process.exit by default
   */
  constructor({ texy = null, debounceMs = 150, lineWidth = 80, onExit = code => process.exit(code) } = {}) {
    this.texy = texy ?? new Texy();
    this.debounceMs = debounceMs;
    this.lineWidth = lineWidth;
    this.onExit = onExit;
    this.store = new DocumentStore();
    this.shutdownReceived = false;

    /** @type {Map<string, { map: Int32Array, normalized: string, uses: Array, definitions: Map }>} per-uri analysis of the last analyze() */
    this.analysis = new Map();

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
      case "textDocument/definition":
        return this.definition(params ?? {});
      case "textDocument/references":
        return this.references(params ?? {});
      case "textDocument/foldingRange":
        return this.foldingRanges(params ?? {});
      case "textDocument/formatting":
        return this.formatting(params ?? {});
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
    if (options.lineWidth !== undefined) {
      this.lineWidth = options.lineWidth;
    }

    return {
      capabilities: {
        positionEncoding: "utf-16",
        textDocumentSync: {
          openClose: true,
          change: 1, // full-document sync
        },
        definitionProvider: true,
        referencesProvider: true,
        foldingRangeProvider: true,
        documentFormattingProvider: true,
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
    this.analysis.delete(uri);
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
    const { document: ast, issues } = this.texy.lint(text); // parse() re-normalizes, idempotently
    this.analysis.set(uri, { map, normalized: text, ast, ...collectReferences(ast), foldings: collectFoldings(ast) });

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

  /**
   * Go-to-definition on a link/image reference use: the cursor position is
   * bridged from the document's coordinates into the normalized source,
   * matched against the exact [ref] token, and the definition node's range
   * is bridged back out.
   * @param {Object} params textDocument/definition
   * @returns {?Object} Location, or null off-token/undefined-reference
   */
  definition(params) {
    const uri = params.textDocument?.uri;
    const document = this.store.get(uri);
    const analysis = this.analysis.get(uri);
    if (document === null || analysis === undefined) {
      return null;
    }

    const use = this.useAt(analysis, params.position, document);
    if (use === null) {
      return null;
    }

    const definitionNode = analysis.definitions.get(use.name.toLowerCase());
    if (definitionNode === undefined || definitionNode.range === null) {
      return null; // reference not defined in this document
    }

    return {
      uri,
      range: toLspRange(definitionNode.range, analysis.map, document.lineStarts),
    };
  }

  /**
   * Find References: all use sites of the reference name under the cursor,
   * whether the cursor sits on a use token or on the definition line.
   * With context.includeDeclaration the definition itself is included.
   * @param {Object} params textDocument/references
   * @returns {?Array<Object>} Locations, or null off any reference
   */
  references(params) {
    const uri = params.textDocument?.uri;
    const document = this.store.get(uri);
    const analysis = this.analysis.get(uri);
    if (document === null || analysis === undefined) {
      return null;
    }

    const offset = normalizedOffsetAt(analysis.map, offsetAt(document.lineStarts, params.position ?? { line: 0, character: 0 }));

    // the name under the cursor: a use token, else a definition line
    let name = null;
    const use = this.useAt(analysis, params.position, document);
    if (use !== null) {
      name = use.name;
    } else {
      for (const node of analysis.definitions.values()) {
        if (node.range !== null && node.range.offset <= offset && offset < node.range.offset + node.range.length) {
          name = node.reference;
          break;
        }
      }
    }
    if (name === null) {
      return null;
    }

    const key = name.toLowerCase();
    const locations = [];
    for (const candidate of analysis.uses) {
      if (candidate.name.toLowerCase() !== key) {
        continue;
      }
      const token = refTokenRange(candidate, analysis.normalized);
      if (token === null) {
        continue;
      }
      locations.push({ uri, range: toLspRange(token, analysis.map, document.lineStarts) });
    }

    if (params.context?.includeDeclaration !== false) {
      const definitionNode = analysis.definitions.get(key);
      if (definitionNode !== undefined && definitionNode.range !== null) {
        locations.push({ uri, range: toLspRange(definitionNode.range, analysis.map, document.lineStarts) });
      }
    }

    return locations;
  }

  /**
   * Full-document formatting: each block whose formatted text differs from
   * its source becomes one TextEdit over its exact span; the gaps between
   * blocks are never part of an edit, so untouched lines (their line
   * endings included) survive byte-identically.
   * @param {Object} params textDocument/formatting
   * @returns {?Array<Object>} TextEdits, empty when already formatted
   */
  formatting(params) {
    const uri = params.textDocument?.uri;
    const document = this.store.get(uri);
    const analysis = this.analysis.get(uri);
    if (document === null || analysis === undefined) {
      return null;
    }

    return formatDocument(analysis.ast, analysis.normalized, this.lineWidth).map(edit => ({
      range: {
        start: positionAt(document.lineStarts, analysis.map[edit.range.offset]),
        end: positionAt(document.lineStarts, analysis.map[edit.range.offset + edit.range.length]),
      },
      newText: edit.text,
    }));
  }

  /**
   * Folding ranges over the document's multi-line block constructs.
   * @param {Object} params textDocument/foldingRange
   * @returns {?Array<Object>} FoldingRanges
   */
  foldingRanges(params) {
    const uri = params.textDocument?.uri;
    const document = this.store.get(uri);
    const analysis = this.analysis.get(uri);
    if (document === null || analysis === undefined) {
      return null;
    }

    return toFoldingRanges(analysis.foldings, analysis.map, document.lineStarts);
  }

  /**
   * The reference use whose [ref] token contains the cursor, if any.
   * @param {{ map: Int32Array, normalized: string, uses: Array }} analysis
   * @param {{ line: number, character: number }} position
   * @param {TextDocument} document
   * @returns {?{ name: string, node: Object }}
   */
  useAt(analysis, position, document) {
    const offset = normalizedOffsetAt(analysis.map, offsetAt(document.lineStarts, position ?? { line: 0, character: 0 }));
    return (
      analysis.uses.find(u => {
        const token = refTokenRange(u, analysis.normalized);
        return token !== null && token.offset <= offset && offset < token.offset + token.length;
      }) ?? null
    );
  }
}
