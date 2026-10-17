/**
 * Resolves the Node.js-only ImageDimensions implementation once, at module
 * load: file-system access exists only on Node.js (not e.g. Cloudflare
 * Workers), where the dynamic import of the node:fs-based module rejects.
 * The import stays dynamic so ImageDimensions.js (node:fs in its static
 * graph) is never part of a Workers bundle.
 *
 * Settling here keeps renderer construction and rendering synchronous -
 * loading in the Renderer constructor raced the first render, leaving
 * imageDimensions undefined.
 */

/** @type {typeof import('./ImageDimensions.js').ImageDimensions | null} null without file-system access */
const ImageDimensions = await import("./ImageDimensions.js")
  .then(module => module.ImageDimensions)
  .catch(() => null);

/**
 * Creates the dimension sniffer for the renderer: the real implementation
 * with file-system access, or a no-op without it.
 * @param {import('./Config.js').Config} config
 * @returns {{ detect(node: import('../../nodes.js').ImageNode): [?number, ?number] }}
 */
export function createImageDimensions(config) {
  return ImageDimensions === null ? { detect: () => [null, null] } : new ImageDimensions(config);
}
