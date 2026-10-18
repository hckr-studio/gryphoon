/**
 * LSP base protocol framing: Content-Length headers count UTF-8 bytes,
 * bodies are complete JSON values, partial deliveries are buffered.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { createMessageReader, writeMessage } from "../src/framing.js";

/** Reads all messages from one concatenated buffer; resolves on stream end. */
function readAll(chunks) {
  return new Promise(resolve => {
    const messages = [];
    const stream = Readable.from(chunks.map(c => Buffer.from(c, "utf8")));
    createMessageReader(stream, m => messages.push(m));
    stream.on("end", () => resolve(messages));
  });
}

describe("framing", () => {
  it("reads a simple framed message", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const [message] = await readAll([`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`]);
    assert.equal(message.id, 1);
    assert.equal(message.method, "initialize");
  });

  it("Content-Length counts UTF-8 bytes, not code units", async () => {
    const text = "žluťoučký"; // 9 code units, 12 UTF-8 bytes
    const body = JSON.stringify({ method: "x", params: { text } });
    const bytes = Buffer.byteLength(body, "utf8");
    const [message] = await readAll([`Content-Length: ${bytes}\r\n\r\n${body}`]);
    assert.equal(message.params.text, text);
  });

  it("buffers a body delivered across chunk boundaries", async () => {
    const body = JSON.stringify({ method: "a", params: { n: 1 } });
    const head = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    const [message] = await readAll([head.slice(0, 10), head.slice(10), body.slice(0, 5), body.slice(5)]);
    assert.deepEqual(message.params, { n: 1 });
  });

  it("reads several messages from one chunk and one from several chunks", async () => {
    const a = JSON.stringify({ method: "a" });
    const b = JSON.stringify({ method: "b" });
    const messages = await readAll([`Content-Length: ${a.length}\r\n\r\n${a}Content-Length: ${b.length}\r\n\r\n${b}`]);
    assert.deepEqual(messages.map(m => m.method), ["a", "b"]);
  });

  it("skips unparsable bodies and keeps reading", async () => {
    const good = JSON.stringify({ method: "good" });
    const messages = await readAll([`Content-Length: 5\r\n\r\n{bad}Content-Length: ${good.length}\r\n\r\n${good}`]);
    assert.deepEqual(messages.map(m => m.method), ["good"]);
  });

  it("writeMessage produces a parseable frame", async () => {
    let raw = "";
    const sink = new Writable({
      write(chunk, _enc, cb) {
        raw += chunk.toString("utf8");
        cb();
      },
    });
    writeMessage(sink, { jsonrpc: "2.0", id: 7, result: "ok" });
    await new Promise(resolve => sink.end(resolve));

    const [message] = await readAll([raw]);
    assert.equal(message.id, 7);
    assert.equal(message.result, "ok");
  });
});
