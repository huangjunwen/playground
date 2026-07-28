// poll_oneoff: race fd readiness signals against clock timeouts, produce
// completion events. Pure logic over already-decoded SubscriptionValues — the
// syscall layer does the struct codec (Subscription.from / Event.write) at the
// memory boundary.

import { EVENTTYPE, Result } from './consts';
import type { Fd } from './fd';
import type { EventValue, SubscriptionValue } from './struct';

export type Resolved = 'ready' | 'errored' | 'pending';

/** Whether `sub` is satisfiable right now. CLOCK subs are always pending (they
 *  fire only on timeout); fd subs check the fd's `isReady`. An unknown fd is
 *  errored → EBADF. */
export function subReady(
  sub: SubscriptionValue,
  lookupFd: (fd: number) => Fd | undefined,
): Resolved {
  if (sub.type === EVENTTYPE.CLOCK) return 'pending';
  const fd = lookupFd(sub.fd);
  if (!fd) return 'errored';
  return fd.isReady(sub.type) ? 'ready' : 'pending';
}

/** Build an EventValue describing `sub`'s resolution. FD_READ carries
 *  availableBytes() as nbytes; everything else is 0. */
function toEvent(
  sub: SubscriptionValue,
  state: Resolved,
  lookupFd: (fd: number) => Fd | undefined,
): EventValue {
  if (state === 'errored') {
    return { userdata: sub.userdata, type: sub.type, errno: Result.EBADF, nbytes: 0n };
  }
  let nbytes = 0n;
  if (sub.type === EVENTTYPE.FD_READ) {
    const fd = lookupFd(sub.fd);
    if (fd) nbytes = BigInt(fd.availableBytes());
  }
  return { userdata: sub.userdata, type: sub.type, errno: Result.SUCCESS, nbytes };
}

/** Smallest wait (ms) across all CLOCK subs, relative to `nowMs`. `Infinity`
 *  if there are no clocks. Absolute deadlines are converted to a relative wait. */
function computeMinClockMs(subs: SubscriptionValue[], nowMs: number): number {
  let min = Infinity;
  for (const sub of subs) {
    if (sub.type !== EVENTTYPE.CLOCK) continue;
    if (sub.absolute) {
      const deadlineMs = Number(sub.timeoutNs / 1_000_000n);
      const waitMs = Math.max(0, deadlineMs - nowMs);
      if (waitMs < min) min = waitMs;
    } else {
      const ms = Number(sub.timeoutNs / 1_000_000n);
      if (ms < min) min = ms;
    }
  }
  return min;
}

/** Register one-shot readiness callbacks on every fd sub's fd, returning the
 *  raced promises plus a `cancel` that deregisters every handler. The
 *  deregister MUST run after each poll cycle so handlers don't accumulate. */
function collectFdSignals(
  subs: SubscriptionValue[],
  lookupFd: (fd: number) => Fd | undefined,
): { signals: Promise<void>[]; cancel: () => void } {
  const signals: Promise<void>[] = [];
  const deregisters: (() => void)[] = [];
  for (const sub of subs) {
    if (sub.type === EVENTTYPE.CLOCK) continue;
    const fd = lookupFd(sub.fd);
    if (!fd) continue;
    signals.push(
      new Promise<void>(resolve => {
        deregisters.push(fd.onReady(sub.type, resolve));
      }),
    );
  }
  return {
    signals,
    cancel: () => {
      for (const d of deregisters) d();
    },
  };
}

export async function runPoll(
  subs: SubscriptionValue[],
  lookupFd: (fd: number) => Fd | undefined,
  sleepFn: (ms: number) => Promise<void>,
  nowMs: () => number = Date.now,
): Promise<EventValue[]> {
  if (subs.length === 0) return [];

  // step 0: anything already ready/errored fires immediately.
  const step0: EventValue[] = [];
  for (const sub of subs) {
    const state = subReady(sub, lookupFd);
    if (state === 'ready' || state === 'errored') {
      step0.push(toEvent(sub, state, lookupFd));
    }
  }
  if (step0.length > 0) return step0;

  // step 1: race fd readiness signals against the nearest clock timeout.
  const startMs = nowMs();
  const waitMs = computeMinClockMs(subs, startMs);
  const { signals, cancel } = collectFdSignals(subs, lookupFd);
  if (Number.isFinite(waitMs)) signals.push(sleepFn(waitMs));
  if (signals.length === 0) return [];
  try {
    await Promise.race(signals);
  } finally {
    cancel();
  }
  const elapsedMs = nowMs() - startMs;

  // step 2: re-scan; only subs that actually became ready/errored, or clocks
  // whose timeout has elapsed, produce events.
  const events: EventValue[] = [];
  for (const sub of subs) {
    if (sub.type === EVENTTYPE.CLOCK) {
      const timeoutMs = sub.absolute
        ? Math.max(0, Number(sub.timeoutNs / 1_000_000n) - startMs)
        : Number(sub.timeoutNs / 1_000_000n);
      if (elapsedMs >= timeoutMs) {
        events.push({ userdata: sub.userdata, type: sub.type, errno: Result.SUCCESS, nbytes: 0n });
      }
      continue;
    }
    const state = subReady(sub, lookupFd);
    if (state === 'ready' || state === 'errored') {
      events.push(toEvent(sub, state, lookupFd));
    }
  }
  return events;
}
