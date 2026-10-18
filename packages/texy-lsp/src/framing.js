/**
 * LSP base protocol: JSON-RPC 2.0 messages framed by Content-Length
 * headers (application/vscode-jsonrpc). Content-Length counts UTF-8
 * bytes, so the reader works on buffers and decodes only complete
 * bodies; the writer frames correspondingly.
 */

/**
 * Reads framed messages from a byte stream; each parsed JSON message is
 * passed to onMessage. Malformed frames are skipped in the hope of
 * resynchronizing on the next one.
 * @param {import("node:stream").Readable} readable
 * @param {(message: Object) => void} onMessage
 */
export function createMessageReader(readable, onMessage) {
  let buffer = Buffer.alloc(0);

  readable.on("data", chunk => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (true) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const headers = buffer.subarray(0, separator).toString("latin1");
      const match = headers.match(/Content-Length:\s*(\d+)/i);
      if (match === null) {
        buffer = buffer.subarray(separator + 4);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = separator + 4;
      if (buffer.length < bodyStart + length) {
        return;
      }

      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);

      let message = null;
      try {
        message = JSON.parse(body);
      } catch {
        // skip unparsable bodies, the framing itself stays intact
      }
      if (message !== null) {
        onMessage(message);
      }
    }
  });
}

/**
 * Writes one framed message.
 * @param {import("node:stream").Writable} writable
 * @param {Object} message
 */
export function writeMessage(writable, message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  writable.write(`Content-Length: ${body.length}\r\n\r\n`);
  writable.write(body);
}
