/**
 * The Texy! language server: LSP lifecycle + text document
 * synchronization over any byte streams, and the analysis features -
 * diagnostics (parser lint + reference health), definition,
 * references, highlight, symbols, folding, completion, hover, inlay
 * hints, document links, quick fixes, selection ranges, renaming and
 * (range) formatting.
 *
 * @gryphoon/texy parses and lints in one pass, and issue ranges are
 * bridged from the parser's normalized coordinate space back to the
 * document as the client sent it - every feature speaking positions
 * goes through the same bridge.
 *
 * Protocol error codes are JSON-RPC 2.0 reserved codes.
 */

import { Texy } from "@gryphoon/texy/Texy.js";
import { normalizeWithMap } from "@gryphoon/texy/normalize.js";
import { completeReferences } from "./completion.js";
import { quickFixes } from "./codeActions.js";
import { createMessageReader, writeMessage } from "./framing.js";
import { DocumentStore } from "./documents.js";
import { collectDocumentLinks } from "./documentLinks.js";
import { formatDocument } from "./formatting.js";
import { hoverAt } from "./hover.js";
import { collectInlayHints } from "./inlayHints.js";
import { collectReferences, definitionAt, definitionTokenRange, refNameAt, refTokenRange, referenceIssues, renameEdits, useAt } from "./links.js";
import { offsetAt, normalizedOffsetAt, positionAt, toLspRange } from "./positions.js";
import { selectionChain } from "./selectionRanges.js";
import { collectDocumentSymbols, headingOutline } from "./symbols.js";
import { collectFoldings, toFoldingRanges } from "./folding.js";

const MethodNotFound = -32601;
const InvalidParams = -32602;
const InternalError = -32603;

export class TexyLanguageServer {
  /**
   * @param {Object} [options]
   * @param {Texy} [options.texy]
   * @param {number} [options.debounceMs] didChange analysis delay
   * @param {number} [options.lineWidth] formatting line width
   * @param {(code: number) => void} [options.onExit] exit hook, process.exit by default
   */
  constructor({ texy = null, debounceMs = 150, lineWidth = 80, onExit = code => process.exit(code) } = {}) {
    this.texy = texy ?? new Texy();
    // the built-in instance generates heading ids, so #toc- anchors exist
    // for the anchor completion (a consumer-provided instance keeps its
    // own headingModule.generateID setting)
    if (texy === null) {
      this.texy.headingModule.generateID = true;
    }
    this.debounceMs = debounceMs;
    this.lineWidth = lineWidth;
    this.onExit = onExit;
    this.store = new DocumentStore();
    this.shutdownReceived = false;

    /**
     * Per-uri analysis of the last analyze():
     * map, normalized, ast, uses, definitions, definitionNodes,
     * foldings, issues.
     * @type {Map<string, Object>}
     */
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

  /**
   * @param {string|number} id @param {Object} payload result or error envelope */
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
      case "textDocument/documentHighlight":
        return this.documentHighlight(params ?? {});
      case "textDocument/documentSymbol":
        return this.documentSymbols(params ?? {});
      case "textDocument/foldingRange":
        return this.foldingRanges(params ?? {});
      case "textDocument/completion":
        return this.completion(params ?? {});
      case "textDocument/hover":
        return this.hover(params ?? {});
      case "textDocument/inlayHint":
        return this.inlayHints(params ?? {});
      case "textDocument/documentLink":
        return this.documentLinks(params ?? {});
      case "textDocument/codeAction":
        return this.codeActions(params ?? {});
      case "textDocument/selectionRange":
        return this.selectionRanges(params ?? {});
      case "textDocument/prepareRename":
        return this.prepareRename(params ?? {});
      case "textDocument/rename":
        return this.rename(params ?? {});
      case "textDocument/formatting":
        return this.formatting(params ?? {});
      case "textDocument/rangeFormatting":
        return this.rangeFormatting(params ?? {});
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
      case "workspace/didChangeConfiguration":
        this.didChangeConfiguration(params);
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
        documentHighlightProvider: true,
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        completionProvider: { triggerCharacters: ["[", "*"] },
        hoverProvider: true,
        inlayHintProvider: true,
        documentLinkProvider: {},
        codeActionProvider: { codeActionKinds: ["quickfix"] },
        selectionRangeProvider: true,
        renameProvider: { prepareProvider: true },
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
      },
      serverInfo: { name: "@gryphoon/texy-lsp", version: "0.2.0" },
    };
  }

  /** @param {Object} params workspace/didChangeConfiguration */
  didChangeConfiguration(params) {
    const settings = params.settings ?? {};
    const texy = settings.texy ?? settings;
    if (texy.lineWidth !== undefined) {
      this.lineWidth = texy.lineWidth;
    }
    if (texy.debounceMs !== undefined) {
      this.debounceMs = texy.debounceMs;
    }
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
   * Parses + lints the document and publishes the diagnostics (parser
   * issues plus the reference-health issues) in the original
   * document's coordinates.
   * @param {string} uri
   */
  analyze(uri) {
    const document = this.store.get(uri);
    if (document === null) {
      return;
    }

    const { text, map } = normalizeWithMap(document.text);
    const { document: ast, issues } = this.texy.lint(text); // parse() re-normalizes, idempotently
    const references = collectReferences(ast);
    const entry = {
      map,
      normalized: text,
      ast,
      ...references,
      foldings: collectFoldings(ast),
      issues: [...issues, ...referenceIssues(references.uses, references.definitionNodes)],
    };
    this.analysis.set(uri, entry);

    this.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        diagnostics: entry.issues.map(issue => this.toDiagnostic(issue, entry, document)),
      },
    });
  }

  /**
   * @param {{ code?: string, message: string, range: ?{ offset: number, length: number }, severity: number }} issue
   * @param {{ map: Int32Array }} analysis
   * @param {{ lineStarts: number[] }} document
   */
  toDiagnostic(issue, analysis, document) {
    return {
      range: toLspRange(issue.range, analysis.map, document.lineStarts),
      severity: issue.severity,
      code: issue.code ?? undefined,
      source: "texy",
      message: issue.message,
    };
  }

  /**
   * The normalized offset an LSP position corresponds to.
   * @param {{ map: Int32Array }} analysis
   * @param {TextDocument} document
   * @param {{ line: number, character: number }} [position]
   * @returns {number}
   */
  offsetAtPosition(analysis, document, position) {
    return normalizedOffsetAt(analysis.map, offsetAt(document.lineStarts, position ?? { line: 0, character: 0 }));
  }

  /**
   * The document + analysis pair of the request, or null when either
   * side is missing (not open yet, or not analyzed yet).
   * @param {Object} params
   * @returns {?[TextDocument, Object]}
   */
  contextOf(params) {
    const uri = params.textDocument?.uri;
    const document = this.store.get(uri);
    const analysis = this.analysis.get(uri);
    return document === null || analysis === undefined ? null : [document, analysis, uri];
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
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis, uri] = context;

    const use = useAt(analysis, this.offsetAtPosition(analysis, document, params.position));
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
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis, uri] = context;

    const name = refNameAt(analysis, this.offsetAtPosition(analysis, document, params.position));
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
   * Document Highlight: the use tokens and the definition of the
   * reference name under the cursor.
   * @param {Object} params textDocument/documentHighlight
   * @returns {?Array<Object>} highlights, or null off any reference
   */
  documentHighlight(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    const name = refNameAt(analysis, this.offsetAtPosition(analysis, document, params.position));
    if (name === null) {
      return null;
    }

    const key = name.toLowerCase();
    const highlights = [];
    for (const candidate of analysis.uses) {
      if (candidate.name.toLowerCase() !== key) {
        continue;
      }
      const token = refTokenRange(candidate, analysis.normalized);
      if (token !== null) {
        highlights.push({ range: toLspRange(token, analysis.map, document.lineStarts), kind: 2 }); // Read
      }
    }

    const definitionNode = analysis.definitions.get(key);
    if (definitionNode !== undefined && definitionNode.range !== null) {
      const token = definitionTokenRange(definitionNode, analysis.normalized);
      highlights.push({ range: toLspRange(token, analysis.map, document.lineStarts), kind: 3 }); // Write
    }

    return highlights;
  }

  /**
   * Document symbols: the heading outline (nested by level, each
   * section running to the next same-or-higher heading) and the
   * reference definitions.
   * @param {Object} params textDocument/documentSymbol
   * @returns {?Array<Object>} DocumentSymbols
   */
  documentSymbols(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    const { headings, definitions } = collectDocumentSymbols(analysis.ast, analysis.normalized, analysis.definitionNodes);
    const outline = headingOutline(headings, analysis.normalized.length);

    const toHeadingSymbol = section => ({
      name: section.name,
      detail: `H${section.level}`,
      kind: 15, // String
      range: toLspRange(section.range, analysis.map, document.lineStarts),
      selectionRange: toLspRange(section.selection, analysis.map, document.lineStarts),
      children: section.children.map(toHeadingSymbol),
    });

    const toDefinitionSymbol = symbol => ({
      name: symbol.name,
      detail: symbol.detail ?? undefined,
      kind: 20, // Key
      range: toLspRange(symbol.range, analysis.map, document.lineStarts),
      selectionRange: toLspRange(symbol.selection ?? symbol.range, analysis.map, document.lineStarts),
    });

    const roots = outline
      .map(section => ({ offset: section.range.offset, symbol: toHeadingSymbol(section) }))
      .slice();
    const defs = definitions.map(symbol => ({ offset: symbol.range.offset, symbol: toDefinitionSymbol(symbol) }));
    return [...roots, ...defs]
      .sort((a, b) => a.offset - b.offset)
      .map(entry => entry.symbol);
  }

  /**
   * Completion of link targets: heading anchors after `#` in a link
   * target, reference names inside [ / [* brackets.
   * @param {Object} params textDocument/completion
   * @returns {?Array<Object>} CompletionItems, or null off any context
   */
  completion(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    const items = completeReferences(analysis, this.offsetAtPosition(analysis, document, params.position));
    if (items === null) {
      return null;
    }
    return items.map(item => ({
      label: item.label,
      kind: item.kind,
      detail: item.detail ?? undefined,
      textEdit: {
        range: toLspRange({ offset: item.edit.offset, length: item.edit.length }, analysis.map, document.lineStarts),
        newText: item.text,
      },
    }));
  }

  /**
   * Hover: what the reference under the cursor resolves to.
   * @param {Object} params textDocument/hover
   * @returns {?Object} Hover, or null off anything resolvable
   */
  hover(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    const text = hoverAt(analysis, this.offsetAtPosition(analysis, document, params.position));
    if (text === null) {
      return null;
    }
    return { contents: { kind: "markdown", value: `\`${text}\`` } };
  }

  /**
   * Inlay hints: the resolved target URL after every reference use
   * token in the requested range.
   * @param {Object} params textDocument/inlayHint
   * @returns {?Array<Object>} InlayHints
   */
  inlayHints(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    const from = this.offsetAtPosition(analysis, document, params.range?.start);
    const to = this.offsetAtPosition(analysis, document, params.range?.end);

    return collectInlayHints(analysis, from, to).map(hint => ({
      position: positionAt(document.lineStarts, analysis.map[Math.min(hint.at, analysis.map.length - 1)]),
      label: hint.label,
    }));
  }

  /**
   * Document links over the URLs in the text (autolinks, link/image
   * targets, definition targets).
   * @param {Object} params textDocument/documentLink
   * @returns {?Array<Object>} DocumentLinks
   */
  documentLinks(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis, uri] = context;

    return collectDocumentLinks(analysis.ast, analysis.normalized, uri, analysis.definitions).map(link => ({
      range: toLspRange(link.range, analysis.map, document.lineStarts),
      target: link.target,
    }));
  }

  /**
   * Code actions: quick fixes for the lint issues overlapping the
   * requested range.
   * @param {Object} params textDocument/codeAction
   * @returns {?Array<Object>} CodeActions
   */
  codeActions(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis, uri] = context;

    const from = this.offsetAtPosition(analysis, document, params.range?.start);
    const to = this.offsetAtPosition(analysis, document, params.range?.end);

    return quickFixes(analysis, from, to).map(fix => ({
      title: fix.title,
      kind: "quickfix",
      diagnostics: [this.toDiagnostic(fix.issue, analysis, document)],
      edit: {
        changes: {
          [uri]: fix.edits.map(edit => ({
            range: toLspRange(edit.range, analysis.map, document.lineStarts),
            newText: edit.text,
          })),
        },
      },
    }));
  }

  /**
   * Selection ranges: the nesting chain of AST nodes containing each
   * position, innermost first, the whole document last.
   * @param {Object} params textDocument/selectionRange
   * @returns {?Array<Object>} one SelectionRange per position
   */
  selectionRanges(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    const wholeDocument = { start: { line: 0, character: 0 }, end: positionAt(document.lineStarts, document.text.length) };
    return (params.positions ?? []).map(position => {
      const offset = this.offsetAtPosition(analysis, document, position);
      const chain = [];
      for (const ancestor of selectionChain(analysis.ast, offset)) {
        const range = toLspRange(ancestor, analysis.map, document.lineStarts);
        if (chain.length === 0 || containsRange(range, chain[chain.length - 1])) {
          chain.push(range);
        }
      }
      if (chain.length === 0 || containsRange(wholeDocument, chain[chain.length - 1])) {
        chain.push(wholeDocument);
      }
      return buildSelectionRange(chain);
    });
  }

  /**
   * Prepare Rename: the range of the reference token under the cursor.
   * @param {Object} params textDocument/prepareRename
   * @returns {?Object} { range, placeholder }, or null off any reference
   */
  prepareRename(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    const offset = this.offsetAtPosition(analysis, document, params.position);
    const name = refNameAt(analysis, offset);
    if (name === null) {
      return null;
    }

    const use = useAt(analysis, offset);
    const definition = use === null ? definitionAt(analysis, offset) : null;
    const token = use !== null ? refTokenRange(use, analysis.normalized) : definition !== null ? definitionTokenRange(definition, analysis.normalized) : null;
    if (token === null) {
      return null;
    }

    return { range: toLspRange(token, analysis.map, document.lineStarts), placeholder: name };
  }

  /**
   * Rename: the reference name under the cursor, at every use site and
   * every definition, preserving each site's written form.
   * @param {Object} params textDocument/rename
   * @returns {?Object} WorkspaceEdit, or null off any reference
   */
  rename(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis, uri] = context;

    const name = refNameAt(analysis, this.offsetAtPosition(analysis, document, params.position));
    if (name === null) {
      return null;
    }

    const newName = params.newName ?? "";
    if (!/^[^\s\[\]*"'|:]+$/.test(newName)) {
      throw Object.assign(new Error("Invalid reference name"), { code: InvalidParams });
    }

    const changes = {};
    changes[uri] = renameEdits(analysis, name, newName).map(edit => ({
      range: toLspRange(edit.range, analysis.map, document.lineStarts),
      newText: edit.text,
    }));
    return { changes };
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
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    return this.textEdits(analysis, document, formatDocument(analysis.ast, analysis.normalized, this.lineWidth));
  }

  /**
   * Range formatting: the whole-document block edits restricted to the
   * blocks overlapping the requested range (the block is the unit of
   * change, so an overlapping block is formatted as a whole).
   * @param {Object} params textDocument/rangeFormatting
   * @returns {?Array<Object>} TextEdits, empty when already formatted
   */
  rangeFormatting(params) {
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    const from = this.offsetAtPosition(analysis, document, params.range?.start);
    const to = this.offsetAtPosition(analysis, document, params.range?.end);

    const edits = formatDocument(analysis.ast, analysis.normalized, this.lineWidth).filter(
      edit => edit.range.offset < to && from < edit.range.offset + edit.range.length,
    );
    return this.textEdits(analysis, document, edits);
  }

  /**
   * Normalized-coordinate block edits mapped into TextEdits.
   * @param {Object} analysis
   * @param {TextDocument} document
   * @param {Array<{ range: { offset: number, length: number }, text: string }>} edits
   */
  textEdits(analysis, document, edits) {
    return edits.map(edit => ({
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
    const context = this.contextOf(params);
    if (context === null) {
      return null;
    }
    const [document, analysis] = context;

    return toFoldingRanges(analysis.foldings, analysis.map, document.lineStarts);
  }
}

/**
 * Does range a contain range b?
 */
function containsRange(a, b) {
  return (
    (a.start.line < b.start.line || (a.start.line === b.start.line && a.start.character <= b.start.character)) &&
    (a.end.line > b.end.line || (a.end.line === b.end.line && a.end.character >= b.end.character))
  );
}

/**
 * The LSP SelectionRange linked list: innermost range first, then its
 * ancestors, each wrapping the one before it.
 * @param {Array<{ start: Object, end: Object }>} ranges innermost first
 */
function buildSelectionRange(ranges) {
  let current = null;
  for (const range of [...ranges].reverse()) {
    current = { range, parent: current };
  }
  return current;
}
