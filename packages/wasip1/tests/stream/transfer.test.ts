// Stream data integrity: the provider (one transport endpoint) and consumer
// (the other) exchange bytes completely and in order, under fast-write/slow-read
// and fast-read/slow-write pacing, plus large/tiny chunk and zero-copy edge cases.

import { afterEach, expect, test } from 'vitest';
import { createStreamConsumer, createStreamProvider } from '../../src/ipc-mp';
import {
  buf,
  bytes,
  expectedBytes,
  makeChannel,
  type ReadOutcome,
  readOutcome,
  readValue,
  tick,
} from '../helpers';

// Tests open ports; close them so timers/macrotasks don't leak across files.
const openPorts: MessagePort[] = [];
afterEach(() => {
  for (const p of openPorts) p.close();
  openPorts.length = 0;
});

/** Wire a provider and consumer across a fresh channel. */
function pair(): {
  provider: ReturnType<typeof createStreamProvider>;
  consumer: ReturnType<typeof createStreamConsumer>;
} {
  const [a, b] = makeChannel();
  openPorts.push(a, b);
  return { provider: createStreamProvider(a), consumer: createStreamConsumer(b) };
}

test('fast write then fast read: a single chunk round-trips intact', async () => {
  const { provider, consumer } = pair();
  provider.write(buf(64, 0));
  const chunk = await readValue(consumer);
  expect(bytes(chunk)).toEqual(expectedBytes(64, 0));
});

test('fast write then fast read: many distinct chunks arrive in order', async () => {
  const { provider, consumer } = pair();
  const n = 30;
  for (let i = 0; i < n; i++) provider.write(buf(32, i));

  // Single-reader consumer: read sequentially, not via Promise.all.
  const received: (ArrayBuffer | null)[] = [];
  for (let i = 0; i < n; i++) received.push(await readValue(consumer));
  for (let i = 0; i < n; i++) {
    expect(bytes(received[i])).toEqual(expectedBytes(32, i));
  }
});

test('fast write, slow read: all chunks buffered and drained in order', async () => {
  const { provider, consumer } = pair();
  const n = 50;
  // Provider dumps everything up front (fast write); writes coalesce into a
  // few flushed batches and all arrive before we start reading.
  for (let i = 0; i < n; i++) provider.write(buf(48, i));

  // Consumer reads one at a time, yielding between each (slow read).
  for (let i = 0; i < n; i++) {
    const chunk = await readValue(consumer);
    expect(bytes(chunk)).toEqual(expectedBytes(48, i));
    await tick();
  }
});

test('fast read, slow write: parked reader unblocks per arriving chunk', async () => {
  const { provider, consumer } = pair();
  const n = 40;
  for (let i = 0; i < n; i++) {
    // Park a reader before any data for this round exists.
    const pending = readOutcome(consumer);
    // Write one chunk (slow write), then let it flush + deliver.
    provider.write(buf(48, i));
    const r = (await pending) as ReadOutcome;
    expect(r.ok).toBe(true);
    if (r.ok) expect(bytes(r.value)).toEqual(expectedBytes(48, i));
  }
});

test('large chunk (1 MiB) transfers intact across the boundary', async () => {
  const { provider, consumer } = pair();
  const size = 1024 * 1024;
  provider.write(buf(size, 5));
  const chunk = await readValue(consumer);
  expect(chunk).not.toBeNull();
  expect(chunk!.byteLength).toBe(size);
  expect(bytes(chunk)).toEqual(expectedBytes(size, 5));
});

test('zero-length chunk is dropped (byte-stream: 0 bytes carries no data)', async () => {
  const { provider, consumer } = pair();
  provider.write(buf(0)); // dropped — produces no read
  provider.write(buf(4, 1));
  provider.close();

  expect(bytes(await readValue(consumer))).toEqual(expectedBytes(4, 1));
  expect(await readValue(consumer)).toBeNull();
});

test('zero-copy transfer: written buffer is detached on the provider side', async () => {
  const { provider, consumer } = pair();
  const chunk = buf(128, 9);
  provider.write(chunk);
  await readValue(consumer);
  // The provider flushes with an explicit transfer list, so the originating
  // ArrayBuffer is moved (detached), not cloned.
  expect(chunk.byteLength).toBe(0);
});

test('interleaved: both directions are independent over one channel each', async () => {
  // Provider→consumer on channel A, and a second provider→consumer on channel B,
  // confirming multiple concurrent streams don't interfere.
  const [a1, a2] = makeChannel();
  const [b1, b2] = makeChannel();
  openPorts.push(a1, a2, b1, b2);

  const pa = createStreamProvider(a1);
  const ca = createStreamConsumer(a2);
  const pb = createStreamProvider(b1);
  const cb = createStreamConsumer(b2);

  pa.write(buf(16, 1));
  pb.write(buf(16, 2));

  expect(bytes(await readValue(ca))).toEqual(expectedBytes(16, 1));
  expect(bytes(await readValue(cb))).toEqual(expectedBytes(16, 2));
});
