/**
 * UrlPolicy: the URL scheme security policy (parity with the reference
 * tests/Texy/UrlPolicy.phpt), including the control-character bypass:
 * browsers delete control characters from URLs before parsing, so a scheme
 * hidden behind them ("java\tscript:") must not look scheme-less.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UrlPolicy } from "../src/UrlPolicy.js";

describe("UrlPolicy", () => {
  it("null pattern allows everything", () => {
    const policy = new UrlPolicy();
    assert.equal(policy.isLinkAllowed("javascript:alert(1)"), true);
    assert.equal(policy.isImageAllowed("data:image/png;base64,x"), true);
  });

  it("scheme-less URLs always pass", () => {
    const policy = new UrlPolicy();
    policy.linkPattern = String.raw`~https?:~A`;
    for (const url of ["relative/path.html", "/absolute/path", "#fragment", "?query", "www.example.com"]) {
      assert.equal(policy.isLinkAllowed(url), true, url);
    }
  });

  it("scheme is matched against the pattern", () => {
    const policy = new UrlPolicy();
    policy.linkPattern = String.raw`~https?:|ftp:|mailto:~A`;
    assert.equal(policy.isLinkAllowed("https://example.com"), true);
    assert.equal(policy.isLinkAllowed("mailto:a@b.cz"), true);
    assert.equal(policy.isLinkAllowed("javascript:alert(1)"), false);
    assert.equal(policy.isLinkAllowed("vbscript:x"), false);
  });

  it("scheme detection is case-insensitive and skips leading whitespace", () => {
    const policy = new UrlPolicy();
    policy.linkPattern = String.raw`~https?:~A`;
    assert.equal(policy.isLinkAllowed("JavaScript:alert(1)"), false);
    assert.equal(policy.isLinkAllowed(" javascript:alert(1)"), false);
  });

  it("control characters inside a scheme are deleted before detection (like browsers do)", () => {
    const policy = new UrlPolicy();
    policy.linkPattern = String.raw`~https?:|ftp:|mailto:~A`;
    assert.equal(policy.isLinkAllowed("java\tscript:alert(1)"), false);
    assert.equal(policy.isLinkAllowed("java\nscript:alert(1)"), false);
    assert.equal(policy.isLinkAllowed("java\rscript:alert(1)"), false);
    assert.equal(policy.isLinkAllowed("\u0001javascript:alert(1)"), false); // browsers trim leading C0 controls
    assert.equal(policy.isLinkAllowed("jav\u0000ascript:alert(1)"), false);
    assert.equal(policy.isLinkAllowed("ht\ntps://example.com"), true); // the scheme is recovered after cleaning
    assert.equal(policy.isLinkAllowed("https://example.com/foo\tbar"), true);
    assert.equal(policy.isImageAllowed("https://x/y\tz.png"), true);
    assert.equal(policy.isLinkAllowed("relative/path\tname.html"), true);
  });
});
