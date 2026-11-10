/**
 * Image dimension detection from the file system (Config.imageFileRoot):
 * header parsing for PNG/GIF/JPEG/BMP/WebP and the dimension-scaling
 * arithmetic of the reference.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ImageNode } from "../src/nodes.js";
import { Config } from "../src/Output/Html/Config.js";
import { ImageDimensions, imageSize } from "../src/Output/Html/ImageDimensions.js";

const dir = join(tmpdir(), "texy-image-dimensions-test");

/**
 * Minimal valid-ish header buffers; only the header matters for parsing.
 * @param {number} width
 * @param {number} height
 */
function png(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0); // signature
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function gif(width, height) {
  const buf = Buffer.from("GIF89a");
  return Buffer.concat([buf, Buffer.from([width & 0xff, width >> 8, height & 0xff, height >> 8])]);
}

function jpeg(width, height) {
  // SOI, APP0/JFIF, SOF0, EOI
  const app0 = Buffer.alloc(18);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0.writeUInt16BE(16, 2);
  app0.write("JFIF\0", 4);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 1; // 1 component
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function bmp(width, height) {
  const buf = Buffer.alloc(26);
  buf.write("BM", 0);
  buf.writeUInt32LE(26, 14); // header size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22); // negative = top-down bitmap
  return buf;
}

function webp(width, height) {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(12, 4); // chunk size
  buf.write("WEBPVP8X", 8);
  const w = width - 1,
    h = height - 1;
  buf[24] = w & 0xff;
  buf[25] = (w >> 8) & 0xff;
  buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff;
  buf[28] = (h >> 8) & 0xff;
  buf[29] = (h >> 16) & 0xff;
  return buf;
}

describe("imageSize header parsing", () => {
  it("reads PNG, GIF, JPEG, BMP and WebP headers", () => {
    assert.deepStrictEqual(imageSize(png(3, 2)), [3, 2]);
    assert.deepStrictEqual(imageSize(gif(4, 2)), [4, 2]);
    assert.deepStrictEqual(imageSize(jpeg(3, 2)), [3, 2]);
    assert.deepStrictEqual(imageSize(bmp(5, 4)), [5, 4]);
    assert.deepStrictEqual(imageSize(webp(3, 2)), [3, 2]);
  });

  it("returns null for unknown formats", () => {
    assert.strictEqual(imageSize(Buffer.from("not an image at all, really")), null);
  });
});

describe("ImageDimensions.detect", () => {
  beforeEach(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.png"), png(3, 2));
    writeFileSync(join(dir, "b.gif"), gif(120, 60));
    writeFileSync(join(dir, "c.bin"), Buffer.from("garbage"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** @param {Object} config overwrites for Config */
  function dimensions(config = {}) {
    const cfg = new Config();
    cfg.imageFileRoot = dir;
    Object.assign(cfg, config);
    return new ImageDimensions(cfg);
  }

  it("fills both dimensions from the file", () => {
    const dims = dimensions();
    assert.deepStrictEqual(dims.detect(new ImageNode("a.png")), [3, 2]);
  });

  it("scales the missing dimension by the file aspect ratio", () => {
    const dims = dimensions();
    // width given (120x60 file): height = round(60/120 * 120) = 60
    assert.deepStrictEqual(dims.detect(new ImageNode("b.gif", 120)), [120, 60]);
    // height given: width = round(120/60 * 30) = 60
    assert.deepStrictEqual(dims.detect(new ImageNode("b.gif", null, 30)), [60, 30]);
  });

  it("keeps explicit dimensions untouched", () => {
    const dims = dimensions();
    assert.deepStrictEqual(dims.detect(new ImageNode("a.png", 10, 20)), [10, 20]);
  });

  it("falls back to node dimensions when detection is impossible", () => {
    // unknown file content
    assert.deepStrictEqual(dimensions().detect(new ImageNode("c.bin")), [null, null]);
    // missing file
    assert.deepStrictEqual(dimensions().detect(new ImageNode("missing.png")), [null, null]);
    // parent traversal refused
    assert.deepStrictEqual(dimensions().detect(new ImageNode("../a.png")), [null, null]);
    // absolute URL refused
    assert.deepStrictEqual(dimensions().detect(new ImageNode("https://x/a.png")), [null, null]);
    // no root configured
    assert.deepStrictEqual(dimensions({ imageFileRoot: null }).detect(new ImageNode("a.png")), [null, null]);
  });

  it("caches file probes for the detector lifetime", () => {
    const dims = dimensions();
    dims.detect(new ImageNode("a.png"));
    const cached = dims.getSize(join(dir, "a.png"));
    assert.deepStrictEqual(cached, [3, 2]);
  });
});
