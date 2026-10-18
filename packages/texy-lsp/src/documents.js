/**
 * Open text documents with their line-start index for position math.
 *
 * The store holds the text as the client sent it (original coordinates);
 * normalization to the parser's coordinate space happens per analysis,
 * bridged by normalizeWithMap. Offsets and Position.character are UTF-16
 * code units, the LSP default - plain JS string indices.
 */

/** @param {string} text @returns {number[]} offsets where a line starts */
export function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

export class TextDocument {
  /**
   * @param {string} uri
   * @param {string} languageId
   * @param {number} version
   * @param {string} text
   */
  constructor(uri, languageId, version, text) {
    this.uri = uri;
    this.languageId = languageId;
    this.version = version;
    this.setText(text);
  }

  /** @param {string} text */
  setText(text) {
    this.text = text;
    this.lineStarts = computeLineStarts(text);
  }
}

export class DocumentStore {
  constructor() {
    /** @type {Map<string, TextDocument>} by uri */
    this.documents = new Map();
  }

  /**
   * @param {string} uri
   * @param {string} languageId
   * @param {number} version
   * @param {string} text
   */
  open(uri, languageId, version, text) {
    this.documents.set(uri, new TextDocument(uri, languageId, version, text));
  }

  /** @param {string} uri @returns {?TextDocument} */
  get(uri) {
    return this.documents.get(uri) ?? null;
  }

  /** @param {string} uri */
  close(uri) {
    this.documents.delete(uri);
  }
}
