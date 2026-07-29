const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeLspMessage(json: Record<string, unknown>): Uint8Array {
  const body = encoder.encode(JSON.stringify(json));
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

// Scan buf[from..end) for the byte sequence b"\r\n\r\n" (13 10 13 10),
// which separates LSP headers from the JSON body.  Uses raw byte comparison
// (not a string search) so multi-byte UTF-8 in the body never desyncs.
// Returns the index of the first byte (the CR), or -1 if not found.
function findSeparator(buf: Uint8Array, from: number, end: number): number {
  for (let i = from; i <= end - 4; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

/**
 * Parses LSP Content-Length-framed messages from a byte stream.
 *
 * Uses a geometric-growth buffer (initial 4 KB, doubles when needed) for O(1)
 * amortised accumulation.  When the internal buffer is empty, complete frames
 * are parsed directly from the incoming chunk without copying.
 */
export class LspFrameDecoder {
  private buf: Uint8Array;
  private len = 0;

  constructor(
    private readonly onMessage: (msg: unknown) => void,
    private readonly onError?: (msg: string) => void,
  ) {
    this.buf = new Uint8Array(4096);
  }

  /**
   * Append raw bytes from the stream.
   *
   * When the internal buffer is empty, {@link chunk} is adopted by reference
   * (zero-copy) and parsed in place.  Otherwise the chunk is appended to the
   * internal buffer first.  After parsing, any unconsumed tail is compacted
   * to the front of the buffer for the next call.
   */
  push(chunk: Uint8Array): void {
    if (this.len > 0) {
      this.ensure(this.len + chunk.length);
      this.buf.set(chunk, this.len);
      this.len += chunk.length;
    } else {
      this.buf = chunk;
      this.len = chunk.length;
    }

    const consumed = this.parseBuffer(this.buf, 0, this.len);
    if (consumed > 0) {
      if (consumed < this.len) {
        this.buf.copyWithin(0, consumed, this.len);
      }
      this.len -= consumed;
    }
  }

  /** Grow the internal buffer geometrically (double) until it fits {@link needed} bytes. */
  private ensure(needed: number): void {
    if (needed <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < needed) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  /**
   * Scan buf[start..end) for complete LSP frames.
   *
   * Stops early when only a partial frame (incomplete header or body) is
   * available — the unconsumed tail stays in the buffer for the next
   * {@link push}.  Returns the number of bytes consumed; 0 means nothing
   * could be emitted.
   */
  private parseBuffer(buf: Uint8Array, start: number, end: number): number {
    let off = start;
    while (off <= end - 4) {
      const sep = findSeparator(buf, off, end);
      if (sep === -1) break;
      const bodyStart = sep + 4;
      // Decode the entire header block (off..sep) as a string and match
      // Content-Length within it.  Two-phase scan (find \r\n\r\n first, then
      // regex the header) rather than a single /Content-Length:\s*(\d+)\r\n\r\n/
      // because non-standard servers (vscode-languageserver-node, etc.) may
      // inject extra headers like Content-Type between Content-Length and the
      // blank line.
      const headerStr = decoder.decode(buf.subarray(off, sep));
      const m = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!m) {
        this.onError?.(`header block missing Content-Length: ${headerStr}`);
        off = bodyStart;
        continue;
      }
      const contentLength = Number(m[1]);
      if (end < bodyStart + contentLength) break;
      const bodyBytes = buf.subarray(bodyStart, bodyStart + contentLength);
      try {
        const parsed = JSON.parse(decoder.decode(bodyBytes));
        this.onMessage(parsed);
      } catch (err) {
        this.onError?.(`malformed JSON body: ${err instanceof Error ? err.message : String(err)}`);
      }
      off = bodyStart + contentLength;
    }
    return off - start;
  }
}
