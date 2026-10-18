/**
 * Lint issue collection - a parse-time observer.
 *
 * Texy is forgiving by design: it renders through problems instead of
 * failing. The collector records them: passes and modules that repair or
 * discard report what they did, with the source range of the affected
 * node. Collection is passive - a collector never changes parse output.
 *
 * Ranges index into the normalized source (see src/Range.js), like every
 * other range in the AST.
 */

/**
 * Severity values intentionally mirror the LSP DiagnosticSeverity
 * numbering so a language server can pass them through unmapped.
 */
export const Severity = { Error: 1, Warning: 2, Information: 3, Hint: 4 };

export class LintIssue {
  /**
   * @param {?import('./Range.js').Range} range null when the issue has no exact source position
   * @param {string} message
   * @param {number} severity
   * @param {?string} code stable machine-readable id, e.g. "html/tag-unclosed"
   */
  constructor(range, message, severity = Severity.Warning, code = null) {
    this.range = range;
    this.message = message;
    this.severity = severity;
    this.code = code;
  }
}

export class LintCollector {
  constructor() {
    /** @type {LintIssue[]} */
    this.issues = [];
  }

  /**
   * @param {?import('./Range.js').Range} range
   * @param {string} message
   * @param {Object} [options] { severity, code }
   */
  report(range, message, options = {}) {
    this.issues.push(
      new LintIssue(range, message, options.severity ?? Severity.Warning, options.code ?? null),
    );
  }
}
