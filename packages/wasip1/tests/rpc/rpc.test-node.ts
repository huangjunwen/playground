// RPC client/server over a transport pair: round-trip, error mapping, timeout,
// dispose, the transfer() zero-copy marker (both directions), and concurrency.

import { afterEach, expect, test } from 'vitest';
import type { RpcMethods } from '../../src/ipc';
import { createRpcClient, createRpcServer, transfer } from '../../src/ipc-mp';
import { buf, bytes, expectedBytes, makeChannel, tick } from '../helpers';

const openPorts: MessagePort[] = [];
afterEach(() => {
  for (const p of openPorts) p.close();
  openPorts.length = 0;
});

function link(methods: RpcMethods) {
  const [a, b] = makeChannel();
  openPorts.push(a, b);
  return { client: createRpcClient(a), server: createRpcServer(b, methods) };
}

// ---------- basic round-trip ----------

test('call resolves with the server return value', async () => {
  const { client, server } = link({ add: (a: number, b: number) => a + b });
  await expect(client.call('add', [2, 3])).resolves.toBe(5);
  server.dispose();
  client.dispose();
});

test('call works with no args and various value types', async () => {
  const { client, server } = link({
    none: () => undefined,
    str: () => 'hello',
    obj: () => ({ a: 1, list: [2, 3] }),
    nested: () => new Map([['k', [1, 2, 3]]]),
  });
  await expect(client.call('none')).resolves.toBeUndefined();
  await expect(client.call('str')).resolves.toBe('hello');
  await expect(client.call('obj')).resolves.toEqual({ a: 1, list: [2, 3] });
  const m = (await client.call('nested')) as Map<string, number[]>;
  expect(m.get('k')).toEqual([1, 2, 3]);
  server.dispose();
  client.dispose();
});

// ---------- error mapping ----------

test('unknown method rejects with a TypeError message', async () => {
  const { client, server } = link({});
  await expect(client.call('missing')).rejects.toThrow(/unknown method 'missing'/);
  server.dispose();
  client.dispose();
});

test('thrown Error is mapped: name, message and payload preserved', async () => {
  const { client, server } = link({
    fail: () => {
      const e = new Error('not found');
      e.name = 'FsError';
      (e as { payload?: unknown }).payload = { errno: 44 };
      throw e;
    },
  });
  try {
    await client.call('fail');
    throw new Error('should have rejected');
  } catch (e) {
    const err = e as Error & { payload?: unknown };
    expect(err.message).toBe('not found');
    expect(err.name).toBe('FsError');
    expect(err.payload).toEqual({ errno: 44 });
  }
  server.dispose();
  client.dispose();
});

test('a thrown non-Error is stringified into the rejection', async () => {
  const { client, server } = link({ boom: () => Promise.reject('literal string') });
  await expect(client.call('boom')).rejects.toThrow('literal string');
  server.dispose();
  client.dispose();
});

// ---------- timeout & dispose ----------

test('per-call timeout rejects and is reported', async () => {
  const { client, server } = link({ slow: () => new Promise(r => setTimeout(() => r(1), 50)) });
  await expect(client.call('slow', [], { timeout: 10 })).rejects.toThrow(/timed out after 10ms/);
  // The late response is ignored (no unhandled rejection, call already settled).
  await tick();
  server.dispose();
  client.dispose();
});

test('default timeout from client options applies', async () => {
  const [a, b] = makeChannel();
  openPorts.push(a, b);
  const server = createRpcServer(b, { slow: () => new Promise(r => setTimeout(() => r(1), 50)) });
  const client = createRpcClient(a, { defaultTimeout: 10 });
  await expect(client.call('slow')).rejects.toThrow(/timed out after 10ms/);
  server.dispose();
  client.dispose();
});

test('dispose rejects pending calls and stops listening', async () => {
  const { client, server } = link({ hang: () => new Promise(() => {}) });
  const p = client.call('hang');
  client.dispose();
  await expect(p).rejects.toThrow(/disposed/);
  server.dispose();
});

// ---------- concurrency ----------

test('concurrent calls resolve independently and in any order', async () => {
  const { client, server } = link({
    echo: (x: number) => new Promise(r => setTimeout(() => r(x), 5 + (10 - x))),
  });
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => client.call('echo', [i])));
  expect(results).toEqual([0, 1, 2, 3, 4]);
  server.dispose();
  client.dispose();
});

// ---------- transfer() zero-copy marker ----------

test('server can return transfer(buf): client gets it, server buffer is detached', async () => {
  const serverBuf = buf(32, 7);
  const { client, server } = link({ give: () => transfer(serverBuf) });

  const got = (await client.call('give')) as ArrayBuffer;
  expect(got.byteLength).toBe(32);
  expect(bytes(got)).toEqual(expectedBytes(32, 7));
  // Moved, not cloned: the server-side backing buffer is now detached.
  expect(serverBuf.byteLength).toBe(0);
  server.dispose();
  client.dispose();
});

test('client can pass transfer(buf) in args: received intact, sender detached', async () => {
  let received: ArrayBuffer | undefined;
  const { client, server } = link({
    take: (x: ArrayBuffer) => {
      received = x;
      return 'ok';
    },
  });

  const mine = buf(16, 3);
  await expect(client.call('take', [transfer(mine)])).resolves.toBe('ok');
  expect(received!.byteLength).toBe(16);
  expect(bytes(received)).toEqual(expectedBytes(16, 3));
  // Detached on the sender side.
  expect(mine.byteLength).toBe(0);
  server.dispose();
  client.dispose();
});

test('transfer marker nested inside a plain object is still transferred', async () => {
  const inner = buf(8, 9);
  const { client, server } = link({ give: () => ({ data: transfer(inner), meta: 1 }) });

  const got = (await client.call('give')) as { data: ArrayBuffer; meta: number };
  expect(got.meta).toBe(1);
  expect(bytes(got.data)).toEqual(expectedBytes(8, 9));
  expect(inner.byteLength).toBe(0); // nested transfer detached the source
  server.dispose();
  client.dispose();
});
