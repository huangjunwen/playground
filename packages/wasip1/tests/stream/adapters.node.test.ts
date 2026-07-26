// Web Stream adapters in src/ipc.ts: toWritableStream wraps a StreamProvider,
// toReadableStream wraps a StreamConsumer. Verify they carry data, EOF and
// errors across the channel.

import { afterEach, expect, test } from 'vitest';
import { toReadableStream, toWritableStream } from '../../src/ipc';
import { createStreamConsumer, createStreamProvider } from '../../src/ipc-mp';
import { buf, bytes, expectedBytes, makeChannel, tick } from '../helpers';

const openPorts: MessagePort[] = [];
afterEach(() => {
  for (const p of openPorts) p.close();
  openPorts.length = 0;
});

function pair() {
  const [a, b] = makeChannel();
  openPorts.push(a, b);
  return { provider: createStreamProvider(a), consumer: createStreamConsumer(b) };
}

test('toWritableStream: writes + close deliver chunks then EOF to the consumer', async () => {
  const { provider, consumer } = pair();
  const ws = toWritableStream(provider);
  const writer = ws.getWriter();

  await writer.write(buf(16, 1));
  await writer.write(buf(16, 2));
  await writer.close();

  const reader = toReadableStream(consumer).getReader();
  expect(bytes((await reader.read()).value)).toEqual(expectedBytes(16, 1));
  expect(bytes((await reader.read()).value)).toEqual(expectedBytes(16, 2));
  expect((await reader.read()).done).toBe(true);
});

test('toReadableStream: provider-side chunks surface as enqueued chunks + close', async () => {
  const { provider, consumer } = pair();
  const reader = toReadableStream(consumer).getReader();

  provider.write(buf(8, 7));
  provider.write(buf(8, 8));
  provider.close();

  expect(bytes((await reader.read()).value)).toEqual(expectedBytes(8, 7));
  expect(bytes((await reader.read()).value)).toEqual(expectedBytes(8, 8));
  expect((await reader.read()).done).toBe(true);
});

test('toReadableStream: a provider error rejects the readable stream', async () => {
  const { provider, consumer } = pair();
  const reader = toReadableStream(consumer).getReader();

  provider.error('adapter boom');
  await expect(reader.read()).rejects.toThrow('adapter boom');
});

test('toWritableStream: abort propagates as an error to the consumer', async () => {
  const { provider, consumer } = pair();
  const ws = toWritableStream(provider);
  const writer = ws.getWriter();
  await writer.write(buf(8, 0));
  await tick(); // let the first chunk land
  await writer.abort('aborted by caller');

  // Drain the chunk that was already in flight, then expect the error.
  const r = consumer.read();
  if (r instanceof Promise) {
    await expect(r).resolves.toBeInstanceOf(ArrayBuffer);
  }
  await expect(consumer.read()).rejects.toThrow('aborted by caller');
});

test('toReadableStream: consumer cancel reaches the provider via onCancel', async () => {
  const { provider, consumer } = pair();
  const rs = toReadableStream(consumer);
  const cancelled = await new Promise<string>(resolve => {
    provider.onCancel = reason => resolve(reason ?? '');
    void rs.cancel('reader gone');
  });

  expect(cancelled).toBe('reader gone');
  expect(() => provider.write(buf(4))).toThrow(/closed/);
});
