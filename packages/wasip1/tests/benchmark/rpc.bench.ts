// RPC latency benchmark: one call() per sample (request out → response back,
// two message hops). The server method resolves immediately, so each sample is a
// pure round-trip.
//
// Run with:  pnpm --filter @playground/wasip1 test:bench   (vitest bench --run --project node)

import { bench } from 'vitest';
import { createRpcClient, createRpcServer } from '../../src/ipc-mp';
import { makeChannel } from '../helpers';

const [a, b] = makeChannel();
const server = createRpcServer(b, { noop: () => undefined });
const client = createRpcClient(a);

bench(
  'latency: rpc round-trip (noop)',
  async () => {
    await client.call('noop');
  },
  { iterations: 500, time: 0 },
);
