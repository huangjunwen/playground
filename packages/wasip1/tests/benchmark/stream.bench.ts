// Latency benchmarks: time from provider.write() until the chunk arrives at the
// consumer (send→arrive).
//
// Run with:  pnpm --filter @playground/wasip1 test:bench   (vitest bench --run --project node)
//
// Method for send→arrive: the consumer parks a reader BEFORE the write, so the
// parked promise resolves the instant the chunk is delivered — the timed region
// (one bench sample = one write → one delivery) is exactly the transport delay:
//   write → microtask flush → postMessage → message delivery → consumer resolve
// Channels are created once per bench and reused, so per-sample cost is the path
// above, not channel construction.

import { bench } from 'vitest';
import { createStreamConsumer, createStreamProvider } from '../../src/ipc-mp';
import { buf, makeChannel } from '../helpers';

const KB = 1024;

function streamPair() {
  const [a, b] = makeChannel();
  return { p: createStreamProvider(a), c: createStreamConsumer(b) };
}

// --- send→arrive latency, by chunk size (allocation is negligible at these
// sizes; the number is the irreducible per-message transport floor) ---

const small = streamPair();
bench(
  'latency: send→arrive, 64 B',
  async () => {
    const pending = small.c.read();
    small.p.write(buf(64));
    await pending;
  },
  { iterations: 500, time: 0 },
);

const medium = streamPair();
bench(
  'latency: send→arrive, 1 KiB',
  async () => {
    const pending = medium.c.read();
    medium.p.write(buf(KB));
    await pending;
  },
  { iterations: 500, time: 0 },
);

const big = streamPair();
bench(
  'latency: send→arrive, 64 KiB',
  async () => {
    const pending = big.c.read();
    big.p.write(buf(64 * KB));
    await pending;
  },
  { iterations: 500, time: 0 },
);
