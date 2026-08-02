/**
 * AlsSession mechanics — queue serialization, response collection, and the
 * end-kind resolution contract of the request API.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { CommandBuilder } from '../src/protocol/commands';
import { AlsSession } from '../src/session';
import { createFakeLsp } from './fake-lsp';

// Flush the microtask/macrotask queue so the stream generator can send its
// `agda` request and park before we inject responses.
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('AlsSession', () => {
  let transport: ReturnType<typeof createFakeLsp>['transport'];
  let session: AlsSession;

  beforeEach(async () => {
    const f = createFakeLsp();
    await f.lsp.start();
    transport = f.transport;
    session = new AlsSession(f.lsp);
  });

  it('dispatches a command and resolves with the end response', async () => {
    const p = session.request(new CommandBuilder('/Test.agda').load());
    expect(transport.agdaCommands.length).toBe(1);
    expect(transport.agdaCommands[0]!.raw).toContain('Cmd_load');
    transport.injectEnd();
    const responses = await p;
    expect(responses.map(r => r.kind)).toEqual(['End']);
  });

  it('collects every intermediate response in arrival order', async () => {
    const p = session.request(new CommandBuilder('/Test.agda').load());
    transport.injectNative({
      kind: 'Status',
      status: { showImplicitArguments: false, showIrrelevantArguments: false, checked: true },
    });
    transport.injectNative({
      kind: 'InteractionPoints',
      interactionPoints: [{ id: 0, range: [] }],
    });
    transport.injectEnd();
    const responses = await p;
    expect(responses.map(r => r.kind)).toEqual(['Status', 'InteractionPoints', 'End']);
  });

  it('queues commands and executes them sequentially', async () => {
    const p1 = session.request(new CommandBuilder('/A.agda').load());
    const p2 = session.request(new CommandBuilder('/B.agda').load());
    expect(transport.agdaCommands.length).toBe(1);
    transport.injectEnd();
    const r1 = await p1;
    expect(r1.map(r => r.kind)).toEqual(['End']);
    expect(transport.agdaCommands.length).toBe(2);
    transport.injectEnd();
    const r2 = await p2;
    expect(r2.map(r => r.kind)).toEqual(['End']);
  });

  it('resolves on DoneExiting for Cmd_exit', async () => {
    const p = session.request(new CommandBuilder('/Test.agda').exit());
    expect(transport.agdaCommands[0]!.raw).toContain('Cmd_exit');
    transport.injectNative({ kind: 'DoneExiting' });
    const responses = await p;
    expect(responses.map(r => r.kind)).toEqual(['DoneExiting']);
  });

  it('stream() yields each response progressively, terminal sentinel last', async () => {
    const kinds: string[] = [];
    const done = (async () => {
      for await (const r of session.stream(new CommandBuilder('/Test.agda').load()))
        kinds.push(r.kind);
    })();
    await flush();
    transport.injectNative({
      kind: 'Status',
      status: { showImplicitArguments: false, showIrrelevantArguments: false, checked: true },
    });
    transport.injectNative({
      kind: 'InteractionPoints',
      interactionPoints: [{ id: 0, range: [] }],
    });
    transport.injectEnd();
    await done;
    expect(kinds).toEqual(['Status', 'InteractionPoints', 'End']);
  });

  it('stream() stops after DoneExiting', async () => {
    const kinds: string[] = [];
    const done = (async () => {
      for await (const r of session.stream(new CommandBuilder('/Test.agda').exit()))
        kinds.push(r.kind);
    })();
    await flush();
    transport.injectNative({ kind: 'DoneExiting' });
    await done;
    expect(kinds).toEqual(['DoneExiting']);
  });
});
