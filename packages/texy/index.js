import { Texy } from "./src/Texy.js";

export { processTypo } from "./src/Typography.js";

/**
 * Converts Texy text to HTML.
 * @param {string} text
 * @param {boolean} singleLine
 * @returns {string}
 */
export function process(text, singleLine = false) {
  const texy = new Texy();
  return texy.process(text, singleLine);
}
