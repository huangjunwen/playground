import { describe, expect, it, vi } from 'vitest';
import type { LspTransport } from '../../src/transport';
import { LoggingTransport } from '../../src/transport-logging';

function fakeInner() {
  const sent: Record<string, unknown>[] = [];
  const handlers = new Set<(m: Record<string, unknown>) => void>();
  const inner: LspTransport = {
    send: m => {
      sent.push(m);
    },
    onMessage: h => {
      handlers.add(h);
      return () => {
        handlers.delete(h);
      };
    },
  };
  return {
    inner,
    sent,
    emit: (m: Record<string, unknown>) => {
      for (const h of handlers) h(m);
    },
  };
}

describe('LoggingTransport', () => {
  it('logs and forwards outbound send', () => {
    const { inner, sent } = fakeInner();
    const log = vi.fn();
    const t = new LoggingTransport(inner, log);
    t.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(log).toHaveBeenCalledWith('out', { jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(sent).toEqual([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  });

  it('logs and forwards inbound messages, and unsubscribe stops delivery', () => {
    const { inner, emit } = fakeInner();
    const log = vi.fn();
    const received: Record<string, unknown>[] = [];
    const t = new LoggingTransport(inner, log);
    const off = t.onMessage(m => {
      received.push(m);
    });
    emit({ jsonrpc: '2.0', method: 'hi' });
    expect(log).toHaveBeenCalledWith('in', { jsonrpc: '2.0', method: 'hi' });
    expect(received).toEqual([{ jsonrpc: '2.0', method: 'hi' }]);
    off();
    emit({ jsonrpc: '2.0', method: 'bye' });
    expect(received).toHaveLength(1);
  });

  it('logs each inbound message once regardless of handler count', () => {
    const { inner, emit } = fakeInner();
    const log = vi.fn();
    const a: Record<string, unknown>[] = [];
    const b: Record<string, unknown>[] = [];
    const t = new LoggingTransport(inner, log);
    t.onMessage(m => {
      a.push(m);
    });
    t.onMessage(m => {
      b.push(m);
    });
    emit({ jsonrpc: '2.0', method: 'hi' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('in', { jsonrpc: '2.0', method: 'hi' });
    expect(a).toEqual([{ jsonrpc: '2.0', method: 'hi' }]);
    expect(b).toEqual([{ jsonrpc: '2.0', method: 'hi' }]);
  });
});
