/** @type {typeof import('./ImageDimensions.js').ImageDimensions | null} null without file-system access */
let ImageDimensions = null;
import("./ImageDimensions.js")
  .then(module => {
    ImageDimensions = module.ImageDimensions;
  })
  .catch(() => {
    // no file-system access (e.g. Cloudflare Workers)
  });

/**
 * Creates the dimension sniffer for the renderer: the real implementation
 * with file-system access, or a no-op without it.
 * @param {import('./Config.js').Config} config
 * @returns {{ detect(node: import('../../nodes.js').ImageNode): [?number, ?number] }}
 */
export function createImageDimensions(config) {
  /** @type {?import('./ImageDimensions.js').ImageDimensions} */
  let instance = null;
  return {
    detect(node) {
      if (ImageDimensions === null) return [null, null];
      instance ??= new ImageDimensions(config);
      return instance.detect(node);
    },
  };
}
