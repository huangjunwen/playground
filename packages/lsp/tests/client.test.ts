import { describe, expect, it, vi } from 'vitest';
import { LspClient } from '../src/client';
import type { LspTransport } from '../src/transport';

class FakeTransport implements LspTransport {
  sent: unknown[] = [];
  private handlers = new Set<(m: Record<string, unknown>) => void>();
  send(m: unknown): void {
    this.sent.push(m);
  }
  onMessage(h: (m: Record<string, unknown>) => void): () => void {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }
  receive(m: Record<string, unknown>): void {
    for (const h of this.handlers) h(m);
  }
}

function lastSent(t: FakeTransport): Record<string, unknown> {
  return t.sent.at(-1) as Record<string, unknown>;
}

describe('LspClient', () => {
  it('request() sends a Request and resolves on matching Response', async () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    const p = c.request<number>('foo', { a: 1 });
    expect(t.sent).toHaveLength(1);
    const req = t.sent[0] as Record<string, unknown>;
    expect(req.method).toBe('foo');
    const id = req.id as number;
    t.receive({ jsonrpc: '2.0', id, result: 42 });
    await expect(p).resolves.toBe(42);
  });

  it('request() rejects on error Response', async () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    const p = c.request('foo', {});
    const id = (t.sent[0] as Record<string, unknown>).id as number;
    t.receive({ jsonrpc: '2.0', id, error: { code: -1, message: 'boom' } });
    await expect(p).rejects.toMatchObject({ code: -1, message: 'boom' });
  });

  it('notify() sends a Notification without id', () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    c.notify('didOpen', { x: 1 });
    const m = lastSent(t);
    expect(m.method).toBe('didOpen');
    expect('id' in m).toBe(false);
  });

  it('onServerRequest(method, handler) returning a value auto-sends a Response', async () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    c.onServerRequest('ping', () => 'pong');
    t.receive({ jsonrpc: '2.0', id: 5, method: 'ping', params: {} });
    await Promise.resolve();
    expect(lastSent(t)).toEqual({ jsonrpc: '2.0', id: 5, result: 'pong' });
  });

  it('onServerRequest handler returning null is a valid result', async () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    c.onServerRequest('custom/ack', () => null);
    t.receive({ jsonrpc: '2.0', id: 9, method: 'custom/ack', params: {} });
    await Promise.resolve();
    expect(lastSent(t)).toEqual({ jsonrpc: '2.0', id: 9, result: null });
  });

  it('onServerRequest handler throwing sends an error Response', async () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    c.onServerRequest('x', () => {
      throw new Error('boom');
    });
    t.receive({ jsonrpc: '2.0', id: 6, method: 'x', params: {} });
    await Promise.resolve();
    const r = lastSent(t) as { id: number; error: { code: number; message: string } };
    expect(r.id).toBe(6);
    expect(r.error.code).toBe(-32603);
    expect(r.error.message).toBe('boom');
  });

  it('unregistered server Request method auto-sends MethodNotFound (-32601)', async () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    // No onServerRequest('nope', ...) registered.
    t.receive({ jsonrpc: '2.0', id: 7, method: 'nope', params: {} });
    await Promise.resolve();
    expect(lastSent(t)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32601, message: 'Method not found' },
    });
  });

  it('onServerRequest unsubscribe stops handling that method', async () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    const off = c.onServerRequest('m', () => 1);
    off();
    t.receive({ jsonrpc: '2.0', id: 8, method: 'm', params: {} });
    await Promise.resolve();
    expect(lastSent(t)).toEqual({
      jsonrpc: '2.0',
      id: 8,
      error: { code: -32601, message: 'Method not found' },
    });
  });

  it('onServerNotification(method, handler) receives only that method', () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    const fn = vi.fn();
    c.onServerNotification('diag', fn);
    t.receive({ jsonrpc: '2.0', method: 'diag', params: { x: 1 } });
    expect(fn).toHaveBeenCalledWith({ x: 1 });
    // Unregistered 'other' notifications are dropped silently.
    t.receive({ jsonrpc: '2.0', method: 'other', params: {} });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('start() sends initialize + initialized and stores serverCapabilities', async () => {
    const t = new FakeTransport();
    const c = new LspClient(t);
    const p = c.start();
    const initReq = t.sent[0] as Record<string, unknown>;
    expect(initReq.method).toBe('initialize');
    const id = initReq.id as number;
    t.receive({ jsonrpc: '2.0', id, result: { capabilities: { hoverProvider: true } } });
    await p;
    expect(c.serverCapabilities).toEqual({ hoverProvider: true });
    expect(lastSent(t).method).toBe('initialized');
    expect('id' in lastSent(t)).toBe(false);
  });
});
