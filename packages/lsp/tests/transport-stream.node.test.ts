import { describe, expect, it } from 'vitest';
import { ByteStreamLspTransport } from '../src/transport-stream';

describe('ByteStreamLspTransport', () => {
  it('round-trips a message through in-memory streams', async () => {
    const received: Record<string, unknown>[] = [];
    let sinkBuffer: Uint8Array = new Uint8Array(0);
    const input = new WritableStream<ArrayBuffer>({
      write(chunk) {
        sinkBuffer = concat(sinkBuffer, new Uint8Array(chunk));
      },
    });
    const output = new ReadableStream<ArrayBuffer>({
      start(controller) {
        const enc = new TextEncoder();
        const body = enc.encode(JSON.stringify({ jsonrpc: '2.0', method: 'hi', params: { n: 1 } }));
        const header = enc.encode(`Content-Length: ${body.length}\r\n\r\n`);
        controller.enqueue(header.buffer);
        controller.enqueue(body.buffer);
        controller.close();
      },
    });
    const transport = new ByteStreamLspTransport(input, output);
    transport.onMessage(m => received.push(m));
    await waitForMicrotasks();
    expect(received).toEqual([{ jsonrpc: '2.0', method: 'hi', params: { n: 1 } }]);

    transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const text = new TextDecoder().decode(sinkBuffer);
    expect(text).toContain('"method":"ping"');
    expect(text).toMatch(/Content-Length: \d+\r\n\r\n/);
  });
});

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function waitForMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
