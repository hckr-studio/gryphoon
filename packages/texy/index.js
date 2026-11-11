import { Configurator } from "./src/Configurator.js";
import { Module } from "./src/Modules/Module.js";
import { Syntax } from "./src/Syntax.js";
import { Texy } from "./src/Texy.js";

/**
 * Marks a built-in preset; survives object spread, so
 * `defTexy({ ...Configuration.safe, ... })` applies the preset as the
 * base configuration and the user's own keys override it by name.
 */
const Preset = Symbol("texy.preset");

/** @type {Object<string, (texy: Texy) => void>} */
const presets = { safe: Configurator.safeMode };

/**
 * Built-in configuration presets, spreadable into defTexy()'s
 * configuration object.
 */
export const Configuration = {
  /** untrusted input (web comments etc.) - Configurator.safeMode semantics */
  safe: { [Preset]: "safe" },
};

/**
 * Creates a configured Texy instance from a declarative object.
 *
 * <code>
 * const texy = defTexy({
 *   ...Configuration.safe,
 *   allowed: [Syntax.Inserted, Syntax.Deleted, Syntax.Subscript, Syntax.Superscript],
 *   htmlPolicy: { allowedTags: false },
 *   headingModule: { top: 4 },
 * });
 * </code>
 *
 * @param {?{
 *   allowed?: Array<string>|Object<string, boolean>,
 *   htmlPolicy?: Object<string, *>,
 *   urlPolicy?: Object<string, *>,
 *   htmlOutput?: Object<string, *>,
 * }} [config] section objects assign onto the matching instance
 * properties; every other key must be a module handle
 * (headingModule, phraseModule, ...). A spread preset
 * (...Configuration.safe) applies its configurator first.
 * @returns {Texy}
 */
export function defTexy(config) {
  const texy = new Texy();
  if (!config) {
    return texy;
  }

  const { allowed, htmlPolicy, urlPolicy, htmlOutput, ...modules } = config;

  if (config[Preset]) {
    presets[config[Preset]](texy);
  }

  if (Array.isArray(allowed)) {
    for (const name of allowed) {
      texy.allowed[name] = true;
    }
  } else if (allowed) {
    Object.assign(texy.allowed, allowed);
  }
  if (htmlPolicy) {
    Object.assign(texy.htmlPolicy, htmlPolicy);
  }
  if (urlPolicy) {
    Object.assign(texy.urlPolicy, urlPolicy);
  }
  if (htmlOutput) {
    Object.assign(texy.htmlOutput, htmlOutput);
  }
  for (const [name, section] of Object.entries(modules)) {
    if (!(texy[name] instanceof Module)) {
      throw new TypeError(`Unknown defTexy() configuration section: ${name}`);
    }
    Object.assign(texy[name], section);
  }

  return texy;
}

export { processTypo } from "./src/Typography.js";

export { Configurator, Syntax, Texy };

/**
 * Converts Texy text to HTML.
 * @param {string} text
 * @param {?{
 *   allowed?: Array<string>|Object<string, boolean>,
 *   htmlPolicy?: Object<string, *>,
 *   urlPolicy?: Object<string, *>,
 *   htmlOutput?: Object<string, *>,
 * }} [config] section objects assign onto the matching instance
 * properties; every other key must be a module handle
 * (headingModule, phraseModule, ...). A spread preset
 * (...Configuration.safe) applies its configurator first.
 * @returns {string}
 */
export function process(text, config) {
  const texy = defTexy(config);
  return texy.process(text);
}
