/**
 * Configurator: safeMode/disableLinks/disableImages, replayed against a
 * PHP-generated corpus (tools/configurator-probe.php) over hostile inputs,
 * plus the policy values they set.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Configurator, SafeTags } from "../src/Configurator.js";
import { None } from "../src/HtmlPolicy.js";
import { Texy } from "../src/Texy.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const corpus = JSON.parse(readFileSync(join(root, "tests", "fixtures", "configurator-corpus.json"), "utf8"));

/** @param {string} mode @returns {import('../src/Texy.js').Texy} */
function makeTexy(mode) {
  const texy = new Texy();
  if (mode === "safe" || mode === "all") {
    Configurator.safeMode(texy);
  }
  if (mode === "disableLinks" || mode === "all") {
    Configurator.disableLinks(texy);
  }
  if (mode === "disableImages" || mode === "all") {
    Configurator.disableImages(texy);
  }
  return texy;
}

describe("Configurator matches the reference", () => {
  it(`replays the ${corpus.length}-case corpus (hostile inputs, four modes)`, () => {
    for (const c of corpus) {
      assert.strictEqual(
        makeTexy(c.mode).process(c.input),
        c.expected,
        `mode=${c.mode} input=${JSON.stringify(c.input)}`,
      );
    }
  });
});

describe("Configurator policy values", () => {
  it("safeMode restricts classes/styles/tags and URL schemes, forces nofollow", () => {
    const texy = new Texy();
    Configurator.safeMode(texy);

    assert.strictEqual(texy.htmlPolicy.allowedClasses, None);
    assert.strictEqual(texy.htmlPolicy.allowedStyles, None);
    assert.deepStrictEqual(texy.htmlPolicy.allowedTags, { ...SafeTags, "*": ["title", "lang", "dir"] });
    assert.strictEqual(texy.urlPolicy.linkPattern, String.raw`~https?:|ftp:|mailto:~A`);
    assert.strictEqual(texy.urlPolicy.imagePattern, String.raw`~https?:~A`);
    assert.strictEqual(texy.allowed["image"], false);
    assert.strictEqual(texy.allowed["link/definition"], false);
    assert.strictEqual(texy.allowed["html/comment"], false);
    assert.strictEqual(texy.htmlOutput.linkNoFollow, true);
  });

  it("disableLinks drops link syntaxes and the <a> tag", () => {
    const texy = new Texy();
    Configurator.disableLinks(texy);

    assert.strictEqual(texy.allowed["link/email"], false);
    assert.strictEqual(texy.allowed["link/url"], false);
    assert.strictEqual(texy.allowed["link/reference"], false);
    assert.strictEqual(texy.phraseModule.linksAllowed, false);
    assert.strictEqual("a" in texy.htmlPolicy.allowedTags, false);

    // the default whitelist is not shared between instances
    const fresh = new Texy();
    assert.strictEqual("a" in fresh.htmlPolicy.allowedTags, true);
  });

  it("disableImages drops image syntaxes and the img/object/embed/applet tags", () => {
    const texy = new Texy();
    Configurator.disableImages(texy);

    assert.strictEqual(texy.allowed["image"], false);
    assert.strictEqual(texy.allowed["figure"], false);
    assert.strictEqual(texy.allowed["image/definition"], false);
    for (const tag of ["img", "object", "embed", "applet"]) {
      assert.strictEqual(tag in texy.htmlPolicy.allowedTags, false);
    }
  });

  it("cannot be instantiated", () => {
    assert.throws(() => new Configurator(), /Cannot instantiate static class/);
  });
});
