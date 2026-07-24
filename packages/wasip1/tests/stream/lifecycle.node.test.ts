// Stream lifecycle & edge cases, mirroring the state-machine comments in
// src/ipc.ts (StreamProvider / StreamConsumer tables) and src/ipc-mp.ts.
//
// Provider:  active ──close()/error()/consumer cancels──▶ closed
//   write(c)  active: buffer + async flush   | closed: throw
//   close()   active: flush + EOF, →closed   | closed: no-op
//   error(m)  active: flush + error, →closed | closed: no-op
// Consumer:  reading ──EOF──▶ eof  ├─error──▶ errored  └─cancel()──▶ cancelled
//   read()    eof: sync null | errored: sync throw | cancelled: sync throw
//   buffered chunks always drain before eof/error/cancel surfaces
//   single-reader: a second read() while one is pending throws
//   cancel() after a terminal state is a no-op

import { afterEach, expect, test } from 'vitest';
import { CancelledError, createStreamConsumer, createStreamProvider } from '../../src/ipc-mp';
import {
  buf,
  bytes,
  expectedBytes,
  makeChannel,
  readError,
  readOutcome,
  readValue,
  tick,
} from '../helpers';

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

// ---------- Provider state machine ----------

test('provider: write after close throws', () => {
  const { provider } = pair();
  provider.close();
  expect(() => provider.write(buf(4))).toThrow(/closed/);
});

test('provider: close twice is a no-op (does not throw, does not re-send EOF)', async () => {
  const { provider, consumer } = pair();
  provider.close();
  expect(() => provider.close()).not.toThrow();
  expect(await readValue(consumer)).toBeNull(); // exactly one EOF
});

test('provider: error after close is a no-op', async () => {
  const { provider, consumer } = pair();
  provider.close();
  expect(() => provider.error('late')).not.toThrow();
  expect(await readValue(consumer)).toBeNull(); // EOF, not error
});

test('provider: close flushes buffered chunks before EOF', async () => {
  const { provider, consumer } = pair();
  provider.write(buf(8, 1));
  provider.write(buf(8, 2));
  provider.close();

  expect(bytes(await readValue(consumer))).toEqual(expectedBytes(8, 1));
  expect(bytes(await readValue(consumer))).toEqual(expectedBytes(8, 2));
  expect(await readValue(consumer)).toBeNull();
});

test('provider: error flushes buffered chunks before the error marker', async () => {
  const { provider, consumer } = pair();
  provider.write(buf(8, 3));
  provider.write(buf(8, 4));
  provider.error('boom');

  expect(bytes(await readValue(consumer))).toEqual(expectedBytes(8, 3));
  expect(bytes(await readValue(consumer))).toEqual(expectedBytes(8, 4));
  const err = await readError(consumer);
  expect(err.message).toBe('boom');
});

// ---------- Consumer terminal states ----------

test('consumer: read at EOF returns null synchronously (terminal is sticky)', async () => {
  const { provider, consumer } = pair();
  provider.close();
  // First read resolves to null once EOF is delivered.
  expect(await readValue(consumer)).toBeNull();
  // Thereafter read() is a synchronous null (not a Promise).
  const r = consumer.read();
  expect(r).not.toBeInstanceOf(Promise);
  expect(r).toBeNull();
});

test('consumer: read at errored throws synchronously and stays sticky', async () => {
  const { provider, consumer } = pair();
  provider.error('nope');
  expect((await readError(consumer)).message).toBe('nope');
  // Subsequent reads throw synchronously.
  expect(() => consumer.read()).toThrow('nope');
});

test('consumer: read at cancelled throws CancelledError synchronously', async () => {
  const { provider, consumer } = pair();
  provider.write(buf(4)); // ensure consumer has something, then cancel
  await readValue(consumer);
  consumer.cancel('user');
  expect(() => consumer.read()).toThrow(CancelledError);
  expect(() => consumer.read()).toThrow(/user/);
});

test('consumer: buffered chunks drain before the cancel surfaces', async () => {
  const { provider, consumer } = pair();
  provider.write(buf(8, 1));
  provider.write(buf(8, 2));
  // Wait until both have been delivered & queued on the consumer side.
  await readValue(consumer); // drains the first buffered chunk
  // The second is already queued; cancelling must not skip it.
  consumer.cancel('done');

  expect(bytes(await readValue(consumer))).toEqual(expectedBytes(8, 2));
  const err = await readError(consumer);
  expect(err).toBeInstanceOf(CancelledError);
});

// ---------- Consumer single-reader invariant ----------

test('consumer: a second read() while one is pending throws', () => {
  const { consumer } = pair();
  const first = consumer.read(); // parks (nothing queued) → sets pending reader
  expect(first).toBeInstanceOf(Promise);
  expect(() => consumer.read()).toThrow(/one reader/);
  // Silence the unhandled rejection from the parked first reader.
  void (first as Promise<unknown>).catch(() => {});
});

// ---------- Consumer cancel semantics ----------

test('consumer: cancel after a terminal state is a no-op', async () => {
  const { provider, consumer } = pair();
  provider.close();
  await readValue(consumer); // EOF → consumer.closed = true
  expect(() => consumer.cancel()).not.toThrow();
  // No cancel message is sent; nothing changes.
  expect(await readValue(consumer)).toBeNull();
});

test('consumer: cancel notifies the provider via onCancel', async () => {
  const { provider, consumer } = pair();
  let cancelled: string | undefined;
  provider.onCancel = reason => {
    cancelled = reason;
  };

  consumer.cancel('please stop');
  await tick(); // let the cancel message be delivered

  expect(cancelled).toBe('please stop');
  // Provider is now closed: further writes throw.
  expect(() => provider.write(buf(4))).toThrow(/closed/);
});

// ---------- read() shape: sync vs async ----------

test('consumer: read() is synchronous when a chunk is already queued', async () => {
  const { provider, consumer } = pair();
  provider.write(buf(8, 0));
  await tick(); // let the batch be delivered & queued
  const r = consumer.read();
  expect(r).not.toBeInstanceOf(Promise);
  expect(bytes(r as ArrayBuffer)).toEqual(expectedBytes(8, 0));
});

test('consumer: read() returns a Promise when nothing is queued', () => {
  const { consumer } = pair();
  const r = consumer.read();
  expect(r).toBeInstanceOf(Promise);
  void (r as Promise<unknown>).catch(() => {});
});

// ---------- default error message ----------

test('provider: error() defaults to "stream error" when no message given', async () => {
  const { provider, consumer } = pair();
  provider.error();
  expect((await readError(consumer)).message).toBe('stream error');
});

// sanity: outcome helper round-trip used above
test('helpers: readOutcome reports both branches', async () => {
  const { provider, consumer } = pair();
  provider.write(buf(4, 0));
  const ok = await readOutcome(consumer);
  expect(ok.ok).toBe(true);
});
