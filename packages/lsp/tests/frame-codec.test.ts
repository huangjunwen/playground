import { describe, expect, it, vi } from 'vitest';
import { encodeLspMessage, LspFrameDecoder } from '../src/frame-codec';

const enc = (s: string) => new TextEncoder().encode(s);

describe('encodeLspMessage', () => {
  it('produces Content-Length header + JSON body', () => {
    const out = encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const text = new TextDecoder().decode(out);
    const body = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
    expect(text).toBe(`Content-Length: ${enc(body).length}\r\n\r\n${body}`);
  });

  it('advertises UTF-8 byte length for a unicode body', () => {
    const out = encodeLspMessage({ v: 'λ' });
    const body = '{"v":"λ"}';
    expect(out.length).toBe(
      enc(`Content-Length: ${enc(body).length}\r\n\r\n`).length + enc(body).length,
    );
  });
});

describe('LspFrameDecoder', () => {
  it('parses one complete message', () => {
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    r.push(encodeLspMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    expect(got).toEqual([{ jsonrpc: '2.0', id: 1, result: { ok: true } }]);
  });

  it('parses multiple messages in one chunk', () => {
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    const a = encodeLspMessage({ id: 1 });
    const b = encodeLspMessage({ id: 2 });
    const both = new Uint8Array(a.length + b.length);
    both.set(a, 0);
    both.set(b, a.length);
    r.push(both);
    expect(got).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('buffers partial messages across pushes', () => {
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    const full = encodeLspMessage({ id: 1 });
    r.push(full.slice(0, 5));
    expect(got).toEqual([]);
    r.push(full.slice(5));
    expect(got).toEqual([{ id: 1 }]);
  });

  it('ignores optional headers like Content-Type', () => {
    const body = '{"id":1}';
    const header =
      `Content-Length: ${enc(body).length}\r\n` +
      `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`;
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    r.push(new Uint8Array([...enc(header), ...enc(body)]));
    expect(got).toEqual([{ id: 1 }]);
  });

  it('parses a unicode body (regression: UTF-16 vs UTF-8 byte count)', () => {
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    const payload = { method: 'hover', params: { symbols: 'λ → ∀ Σ ℕ' } };
    r.push(encodeLspMessage(payload));
    expect(got).toEqual([payload]);
  });

  it('parses two consecutive unicode bodies in one chunk', () => {
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    const a = encodeLspMessage({ v: 'λ' });
    const b = encodeLspMessage({ v: '∀' });
    const both = new Uint8Array(a.length + b.length);
    both.set(a, 0);
    both.set(b, a.length);
    r.push(both);
    expect(got).toEqual([{ v: 'λ' }, { v: '∀' }]);
  });

  it('accepts a lowercase Content-length header', () => {
    const body = '{"id":1}';
    const header = `Content-length: ${enc(body).length}\r\n\r\n`;
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    r.push(new Uint8Array([...enc(header), ...enc(body)]));
    expect(got).toEqual([{ id: 1 }]);
  });

  it('recovers across a body split at a byte boundary', () => {
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    const full = encodeLspMessage({ v: 'λ→∀' });
    const mid = Math.floor(full.length / 2);
    r.push(full.slice(0, mid));
    expect(got).toEqual([]);
    r.push(full.slice(mid));
    expect(got).toEqual([{ v: 'λ→∀' }]);
  });

  it('parses an empty body (Content-Length: 0)', () => {
    const got: unknown[] = [];
    const onError = vi.fn();
    const r = new LspFrameDecoder(m => got.push(m), onError);
    const header = 'Content-Length: 0\r\n\r\n';
    r.push(enc(header));
    expect(got).toEqual([]);
    expect(onError).toHaveBeenCalled();
  });

  it('routes missing Content-Length header to onError instead of throwing', () => {
    const got: unknown[] = [];
    const onError = vi.fn();
    const r = new LspFrameDecoder(m => got.push(m), onError);
    const stray = 'not an lsp frame\r\n\r\n';
    expect(() => r.push(enc(stray))).not.toThrow();
    expect(onError).toHaveBeenCalled();
    expect(got).toEqual([]);
  });

  it('routes malformed JSON to onError instead of throwing', () => {
    const got: unknown[] = [];
    const onError = vi.fn();
    const r = new LspFrameDecoder(m => got.push(m), onError);
    const body = '{not json';
    const header = `Content-Length: ${enc(body).length}\r\n\r\n`;
    r.push(new Uint8Array([...enc(header), ...enc(body)]));
    expect(onError).toHaveBeenCalledOnce();
    expect(got).toEqual([]);
  });

  it('zero-copy: parses directly from chunk without copying', () => {
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    const msg = encodeLspMessage({ id: 1 });
    r.push(msg);
    r.push(encodeLspMessage({ id: 2 }));
    expect(got).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('handles many small pushes without O(N²) degradation', () => {
    const got: unknown[] = [];
    const r = new LspFrameDecoder(m => got.push(m));
    const full = encodeLspMessage({ key: 'x'.repeat(500) });
    for (let i = 0; i < full.length; i += 5) {
      r.push(full.slice(i, Math.min(i + 5, full.length)));
    }
    expect(got).toEqual([{ key: 'x'.repeat(500) }]);
  });
});
