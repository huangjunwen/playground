// Unit tests for src/poll.ts: subReady (is a subscription satisfiable now?)
// and runPoll (race fd readiness signals against clock timeouts). The struct
// codecs (Subscription.from / Event.write) that poll operates on are exercised
// in tests/struct; here the values are built directly.

import { describe, expect, it } from 'vitest';
import { EVENTTYPE, Result } from '../../src/consts';
import { Fd } from '../../src/fd';
import { runPoll, subReady } from '../../src/poll';
import type { SubscriptionValue } from '../../src/struct';

// Stub Fd whose readiness and available bytes are externally controlled.
// onReady is left at the default (never fires) — none of these tests reach the
// fd-signal race in step 1.
class StubFd extends Fd {
  readonly filetype = 0;
  ready = false;
  bytes = 0;

  isReady(_type: number): boolean {
    return this.ready;
  }

  availableBytes(): number {
    return this.bytes;
  }
}

describe('subReady', () => {
  const fd = new StubFd();
  const lookup = (n: number) => (n === 5 ? fd : undefined);

  it('CLOCK subscriptions are always pending', () => {
    const sub: SubscriptionValue = {
      userdata: 0n,
      type: EVENTTYPE.CLOCK,
      clockId: 0,
      timeoutNs: 0n,
      absolute: false,
    };
    expect(subReady(sub, lookup)).toBe('pending');
  });

  it('unknown fd is errored', () => {
    const sub: SubscriptionValue = { userdata: 0n, type: EVENTTYPE.FD_READ, fd: 999 };
    expect(subReady(sub, lookup)).toBe('errored');
  });

  it('ready fd is ready', () => {
    fd.ready = true;
    const sub: SubscriptionValue = { userdata: 0n, type: EVENTTYPE.FD_READ, fd: 5 };
    expect(subReady(sub, lookup)).toBe('ready');
  });

  it('not-ready fd is pending', () => {
    fd.ready = false;
    const sub: SubscriptionValue = { userdata: 0n, type: EVENTTYPE.FD_READ, fd: 5 };
    expect(subReady(sub, lookup)).toBe('pending');
  });
});

describe('runPoll', () => {
  it('empty subs returns empty events', async () => {
    const events = await runPoll(
      [],
      () => undefined,
      () => new Promise(() => {}),
    );
    expect(events).toEqual([]);
  });

  it('step 0: already-ready fd fires immediately', async () => {
    const fd = new StubFd();
    fd.ready = true;
    fd.bytes = 100;
    const sub: SubscriptionValue = { userdata: 1n, type: EVENTTYPE.FD_READ, fd: 5 };
    const events = await runPoll(
      [sub],
      n => (n === 5 ? fd : undefined),
      () => new Promise<void>(() => {}),
    );
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      userdata: 1n,
      type: EVENTTYPE.FD_READ,
      errno: Result.SUCCESS,
      nbytes: 100n,
    });
  });

  it('step 0: errored fd fires immediately with EBADF', async () => {
    const sub: SubscriptionValue = { userdata: 7n, type: EVENTTYPE.FD_READ, fd: 999 };
    const events = await runPoll(
      [sub],
      () => undefined,
      () => new Promise<void>(() => {}),
    );
    expect(events[0]).toEqual({
      userdata: 7n,
      type: EVENTTYPE.FD_READ,
      errno: Result.EBADF,
      nbytes: 0n,
    });
  });

  it('CLOCK-only subscription fires after timeout elapses', async () => {
    const sub: SubscriptionValue = {
      userdata: 11n,
      type: EVENTTYPE.CLOCK,
      clockId: 0,
      timeoutNs: 50_000_000n, // 50ms
      absolute: false,
    };
    let sleepResolve: () => void = () => {};
    const sleepFn = (_ms: number) =>
      new Promise<void>(resolve => {
        sleepResolve = resolve;
      });
    let mockNow = 1000;
    const eventsP = runPoll(
      [sub],
      () => undefined,
      sleepFn,
      () => mockNow,
    );
    // Advance virtual time past the 50ms deadline, then unblock the sleep.
    mockNow = 1051;
    sleepResolve();
    const events = await eventsP;
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      userdata: 11n,
      type: EVENTTYPE.CLOCK,
      errno: Result.SUCCESS,
      nbytes: 0n,
    });
  });

  it('absolute CLOCK with deadline in the past fires once sleep yields', async () => {
    const sub: SubscriptionValue = {
      userdata: 22n,
      type: EVENTTYPE.CLOCK,
      clockId: 0,
      timeoutNs: 1_000_000n, // 1ms absolute
      absolute: true,
    };
    let sleepResolve: () => void = () => {};
    const sleepFn = (_ms: number) =>
      new Promise<void>(resolve => {
        sleepResolve = resolve;
      });
    // nowMs = 1000ms > 1ms deadline → computeMinClockMs returns 0; sleep is
    // called with 0ms. Step 2 then sees elapsed >= timeout and emits.
    const mockNow = 1000;
    const eventsP = runPoll(
      [sub],
      () => undefined,
      sleepFn,
      () => mockNow,
    );
    sleepResolve();
    const events = await eventsP;
    expect(events.length).toBe(1);
  });

  it('multiple CLOCK subs: nearest timeout is selected for sleepFn', async () => {
    const subs: SubscriptionValue[] = [
      { userdata: 1n, type: EVENTTYPE.CLOCK, clockId: 0, timeoutNs: 100_000_000n, absolute: false },
      { userdata: 2n, type: EVENTTYPE.CLOCK, clockId: 0, timeoutNs: 50_000_000n, absolute: false },
    ];
    let sleepMs = Infinity;
    const sleepFn = (ms: number) => {
      sleepMs = ms;
      return new Promise<void>(() => {});
    };
    // This will hang on the race — we just verify the nearest timeout was selected.
    const eventsP = runPoll(
      subs,
      () => undefined,
      sleepFn,
      () => 0,
    );
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(sleepMs).toBe(50);
    // Suppress unhandled rejection from the never-resolving eventsP.
    eventsP.catch(() => {});
  }, 100);

  it('step 1: fd that becomes ready via onReady wins the race', async () => {
    const fd = new StubFd();
    let fire: () => void = () => {};
    fd.onReady = (_type, cb) => {
      fire = cb;
      return () => {};
    };
    const sub: SubscriptionValue = { userdata: 5n, type: EVENTTYPE.FD_READ, fd: 3 };
    const eventsP = runPoll(
      [sub],
      n => (n === 3 ? fd : undefined),
      () => new Promise<void>(() => {}),
    );
    fd.ready = true;
    fd.bytes = 42;
    fire();
    const events = await eventsP;
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      userdata: 5n,
      type: EVENTTYPE.FD_READ,
      errno: Result.SUCCESS,
      nbytes: 42n,
    });
  });

  it('step 1: fd ready via onReady beats an unelapsed clock (clock suppressed)', async () => {
    const fd = new StubFd();
    let fire: () => void = () => {};
    fd.onReady = (_type, cb) => {
      fire = cb;
      return () => {};
    };
    const clockSub: SubscriptionValue = {
      userdata: 1n,
      type: EVENTTYPE.CLOCK,
      clockId: 0,
      timeoutNs: 100_000_000n,
      absolute: false,
    };
    const fdSub: SubscriptionValue = { userdata: 2n, type: EVENTTYPE.FD_READ, fd: 3 };
    const eventsP = runPoll(
      [clockSub, fdSub],
      n => (n === 3 ? fd : undefined),
      () => new Promise<void>(() => {}),
      () => 0,
    );
    fd.ready = true;
    fd.bytes = 7;
    fire();
    const events = await eventsP;
    expect(events.length).toBe(1);
    expect(events[0].userdata).toBe(2n);
  });

  it('step 1: clock fires when fd stays pending (fd suppressed)', async () => {
    const fd = new StubFd();
    let sleepR: () => void = () => {};
    const sleepFn = (_ms: number) =>
      new Promise<void>(resolve => {
        sleepR = resolve;
      });
    const clockSub: SubscriptionValue = {
      userdata: 9n,
      type: EVENTTYPE.CLOCK,
      clockId: 0,
      timeoutNs: 50_000_000n,
      absolute: false,
    };
    const fdSub: SubscriptionValue = { userdata: 8n, type: EVENTTYPE.FD_READ, fd: 3 };
    let now = 1000;
    const eventsP = runPoll(
      [clockSub, fdSub],
      n => (n === 3 ? fd : undefined),
      sleepFn,
      () => now,
    );
    now = 1051;
    sleepR();
    const events = await eventsP;
    expect(events.length).toBe(1);
    expect(events[0].userdata).toBe(9n);
  });
});
