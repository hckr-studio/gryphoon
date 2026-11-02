import { Texy } from "./src/Texy.js";

export function defTexy(config) {
  const texy = new Texy();

  return texy;
}

export { processTypo } from "./src/Typography.js";

/**
 * Converts Texy text to HTML.
 * @param {string} text
 * @param {boolean} singleLine
 * @returns {string}
 */
export function process(text, singleLine = false) {
  const texy = defTexy();
  return texy.process(text, singleLine);
}
