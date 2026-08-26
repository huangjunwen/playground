/**
 * Command layer — orchestration with the backend seam faked.
 *
 * responseDispatcher (shape-keyed callback table): routes each response to
 * the declared callback and drops everything else. executeLoad (streaming):
 * busy/log/error dispatch in real time as responses arrive; goals rebuild in
 * one dispatch when the stream ends, and only when the load succeeded.
 * executeGive (streaming like load): goal lookup, IOTCM command shape, and the
 * two-transaction application — giveReplacementTransaction then the
 * expandGoalsTransaction + syncGoals assembly — driven through the shared
 * ExecuteContext.executeCommand skeleton. syncToVfs: the one vfs-write
 * path (fs::sync, narrated by the context itself), shared by every
 * explicit save and each command's pre-flight sync.
 */

import { EditorState, Text, type TransactionSpec } from '@codemirror/state';
import type {
  AgdaResponse,
  InteractionPoint,
  IOTCMCommand,
} from '@playground/language-backend-agda';
import { describe, expect, it, vi } from 'vitest';
import {
  type EditorViewLike,
  ExecuteContext,
  executeGive,
  executeLoad,
  responseDispatcher,
} from '../../src/integration/commands';
import { posAt, span } from '../../src/integration/coords';
import { getGoals, goalModelField, setGoals } from '../../src/model/goal-model';
import { getEvents, observabilityModelField } from '../../src/model/observability-model';
import { filePathFacet, getSession, sessionModelField } from '../../src/model/session-model';

const FILE_PATH = '/root/workspace/Main.agda';

function makeView(doc: string): EditorViewLike & { dispatch: ReturnType<typeof vi.fn> } {
  const state = EditorState.create({
    doc,
    extensions: [
      goalModelField,
      sessionModelField,
      observabilityModelField,
      filePathFacet.of(FILE_PATH),
    ],
  });
  const view = {
    state,
    dispatch: vi.fn((...specs: TransactionSpec[]) => {
      view.state = view.state.update(...specs).state;
    }),
  };
  return view;
}

function makeContext(
  doc: string,
  responses: AgdaResponse[],
  goals?: Array<{ id: number; from: number; to: number }>,
): {
  view: EditorViewLike & { dispatch: ReturnType<typeof vi.fn> };
  ctx: ExecuteContext;
  syncToVfs: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
} {
  const view = makeView(doc);
  if (goals) view.dispatch({ effects: [setGoals.of(goals)] });
  const syncToVfs = vi.fn(async () => {});
  const stream = vi.fn(async function* () {
    yield* responses;
  });
  return { view, ctx: new ExecuteContext({ syncToVfs, stream }, view), syncToVfs, stream };
}

function point(id: number, from0: number, to0: number): InteractionPoint {
  return {
    id,
    range: [
      {
        start: { pos: from0 + 1, line: 1, col: from0 + 1 },
        end: { pos: to0 + 1, line: 1, col: to0 + 1 },
      },
    ],
  };
}

function loadResponses(points: InteractionPoint[], checked = true): AgdaResponse[] {
  return [
    // ALS leads with the Status verdict of the check about to be narrated.
    {
      kind: 'Status',
      status: { showImplicitArguments: false, showIrrelevantArguments: false, checked },
    },
    {
      kind: 'InteractionPoints',
      interactionPoints: points,
    },
    {
      kind: 'DisplayInfo',
      info: {
        kind: 'AllGoalsWarnings',
        visibleGoals: points.map(p => ({
          kind: 'OfType',
          constraintObj: p,
          type: 'Nat',
        })),
        invisibleGoals: [],
        warnings: [],
        errors: [],
      },
    },
    { kind: 'End' },
  ];
}

const errorResponse = (message: string): AgdaResponse => ({
  kind: 'DisplayInfo',
  info: { kind: 'Error', error: { message }, warnings: [] },
});

// ---------------------------------------------------------------------------
// responseDispatcher
// ---------------------------------------------------------------------------

describe('responseDispatcher', () => {
  it('routes each response shape to its callback with the destructured payload', () => {
    const warn = vi.fn();
    const dispatch = responseDispatcher({
      RunningInfo: ({ debugLevel, message }) => warn(debugLevel, message),
      InteractionPoints: ({ interactionPoints }) => warn(interactionPoints.length),
      DisplayInfo: {
        Error: ({ error }) => warn(error.message),
      },
    });

    dispatch({ kind: 'RunningInfo', debugLevel: 1, message: 'Checking' });
    dispatch({ kind: 'InteractionPoints', interactionPoints: [point(0, 5, 6)] });
    dispatch(errorResponse('boom'));

    expect(warn).toHaveBeenCalledWith(1, 'Checking');
    expect(warn).toHaveBeenCalledWith(1);
    expect(warn).toHaveBeenCalledWith('boom');
  });

  it('ignores responses without a matching callback and unknown shapes', () => {
    const seen: string[] = [];
    const dispatch = responseDispatcher({
      GiveAction: ({ giveResult }) => seen.push(JSON.stringify(giveResult)),
    });

    dispatch({ kind: 'ClearRunningInfo' });
    dispatch({
      kind: 'Status',
      status: { showImplicitArguments: false, showIrrelevantArguments: false, checked: true },
    });
    dispatch({ kind: 'Unknown' });

    expect(seen).toEqual([]);
  });

  it('ignores DisplayInfo variants the caller did not declare', () => {
    const dispatch = responseDispatcher({
      DisplayInfo: {
        AllGoalsWarnings: () => expect.unreachable('wrong variant'),
      },
    });

    dispatch(errorResponse('boom'));
  });
});

describe('posAt / span (1-based coordinate helpers)', () => {
  it('posAt maps a 0-based offset to 1-based pos/line/col', () => {
    expect(posAt(Text.of(['a = ?', 'b = ?']), 4)).toEqual({ pos: 5, line: 1, col: 5 });
    expect(posAt(Text.of(['a = ?', 'b = ?']), 8)).toEqual({ pos: 9, line: 2, col: 3 });
  });

  it('span maps a 0-based range to a 1-based interval', () => {
    expect(span(Text.of(['a = ?', 'b = ?']), 4, 5)).toEqual([
      {
        start: { pos: 5, line: 1, col: 5 },
        end: { pos: 6, line: 1, col: 6 },
      },
    ]);
  });
});

describe('executeLoad (streaming)', () => {
  it('dispatches busy/log in real time and rebuilds goals when the stream ends', async () => {
    const { view, ctx, syncToVfs, stream } = makeContext('a = ?\nb = ?', [
      { kind: 'RunningInfo', debugLevel: 1, message: 'Checking Main.agda' },
      ...loadResponses([point(0, 4, 5), point(1, 10, 11)]),
    ]);

    await executeLoad(ctx);

    expect(syncToVfs).toHaveBeenCalledTimes(1);
    expect(syncToVfs).toHaveBeenCalledWith(FILE_PATH, 'a = ?\nb = ?');
    expect(stream).toHaveBeenCalledTimes(1);
    const cmd = stream.mock.calls[0][0] as IOTCMCommand;
    expect(cmd.raw).toContain('Cmd_load');
    expect(cmd.raw).toContain('/root/workspace/Main.agda');
    const session = getSession(view.state);
    expect(session.busy).toBe(false);
    expect(session.error).toBeUndefined();
    expect(session.runningInfo).toEqual(['Checking Main.agda', '?0 : Nat', '?1 : Nat']);
    expect(getGoals(view.state)).toEqual([
      { id: 0, from: 4, to: 11, typeString: 'Nat' },
      { id: 1, from: 16, to: 23, typeString: 'Nat' },
    ]);
    expect(view.state.doc.toString()).toBe('a = {!   !}\nb = {!   !}');
    // Status.checked is agda's no-error verdict — unsolved goals do not
    // clear it; the chip composes All Done as checked && no goals.
    expect(getSession(view.state).checked).toBe(true);
  });

  it('sets the error in real time and keeps the old goals when the load fails', async () => {
    const { view, ctx, syncToVfs } = makeContext(
      'a = {! !}',
      [
        {
          kind: 'DisplayInfo',
          info: { kind: 'Error', error: { message: 'Main.agda:1.1: parse error' }, warnings: [] },
        },
        { kind: 'End' },
      ],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeLoad(ctx);

    expect(syncToVfs).toHaveBeenCalledTimes(1);
    const session = getSession(view.state);
    expect(session.error).toContain('parse error');
    expect(session.busy).toBe(false);
    expect(session.checked).toBe(false);
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 9 }]);
    expect(view.state.doc.toString()).toBe('a = {! !}');
    // The common error handler logs the failure — the command itself doesn't.
    const events = getEvents(view.state);
    const errorEvent = events.find(e => e.kind === 'Cmd_load::error');
    expect(errorEvent).toMatchObject({
      level: 'error',
      payload: { error: 'Main.agda:1.1: parse error' },
    });
  });

  it('clears the progress log when ClearRunningInfo arrives mid-stream', async () => {
    const { view, ctx } = makeContext('a = ?', [
      { kind: 'RunningInfo', debugLevel: 1, message: 'Loading interfaces' },
      { kind: 'ClearRunningInfo' },
      ...loadResponses([]),
    ]);

    await executeLoad(ctx);

    expect(getSession(view.state).runningInfo).toEqual(['All Done']);
    expect(getSession(view.state).busy).toBe(false);
    expect(getGoals(view.state)).toEqual([]);
    // No goals left: the file is fully checked.
    expect(getSession(view.state).checked).toBe(true);
  });

  it('lists hidden metas agda-mode style, with their position', async () => {
    const { view, ctx } = makeContext('a = ?', [
      {
        kind: 'DisplayInfo',
        info: {
          kind: 'AllGoalsWarnings',
          visibleGoals: [{ kind: 'OfType', constraintObj: point(0, 4, 5), type: 'Nat' }],
          invisibleGoals: [
            {
              kind: 'OfType',
              constraintObj: {
                name: '_A_3',
                range: [
                  {
                    start: { pos: 30, line: 4, col: 13 },
                    end: { pos: 32, line: 4, col: 15 },
                  },
                ],
              },
              type: 'Set',
            },
          ],
          warnings: [],
          errors: [],
        },
      },
      { kind: 'End' },
    ]);

    await executeLoad(ctx);

    expect(getSession(view.state).runningInfo).toEqual(['?0 : Nat', '_A_3 : Set  [ at 4.13-15 ]']);
  });

  it('brackets the command with sync and stream elapse events', async () => {
    const { view, ctx } = makeContext('a = ?', loadResponses([]));

    await executeLoad(ctx);

    // The wire frames themselves are tapped at the backend layer
    // (backend/backend.ts) — the command layer narrates only what it knows.
    const events = getEvents(view.state);
    expect(events.map(e => [e.level, e.kind])).toEqual([
      ['info', 'fs::sync'],
      ['info', 'Cmd_load::cmdEnd'],
    ]);
    expect(events[0]!.payload).toMatchObject({ elapse: expect.any(String) });
    expect(events[1]!.payload).toMatchObject({ elapse: expect.any(String) });
    expect(events.every((e, i, all) => i === 0 || e.seq === all[i - 1]!.seq + 1)).toBe(true);
  });

  it('narrates a failed sync through the shared fs seam and skips the stream', async () => {
    const view = makeView('a = ?');
    const syncToVfs = vi.fn(async () => {
      throw new Error('fs full');
    });
    const stream = vi.fn(async function* () {});
    const ctx = new ExecuteContext({ syncToVfs, stream }, view);

    await executeLoad(ctx);

    // A stale vfs must not run the command; the session still closes.
    expect(stream).not.toHaveBeenCalled();
    expect(getSession(view.state).busy).toBe(false);
    const events = getEvents(view.state);
    expect(events.map(e => [e.level, e.kind])).toEqual([['error', 'fs::sync']]);
    expect(events[0]!.payload).toMatchObject({ error: 'fs full' });
  });
});

describe('executeGive', () => {
  it('locates the goal, sends Cmd_give with the whole-hole range, and commits in one dispatch', async () => {
    const doc = 'a = {! !}\nb = {! !}';
    const { view, ctx, syncToVfs, stream } = makeContext(
      doc,
      [
        { kind: 'GiveAction', interactionPoint: point(0, 5, 10), giveResult: { paren: false } },
        // give's stream may carry a Status, but give must not consume it:
        // agda's verdict is stale against the just-edited document.
        {
          kind: 'Status',
          status: { showImplicitArguments: false, showIrrelevantArguments: false, checked: true },
        },
        // Full snapshot: fresh goal 2 plus survivor 1 (response range ignored —
        // the state position after remap is authoritative).
        { kind: 'InteractionPoints', interactionPoints: [point(2, 8, 9), point(1, 99, 199)] },
        {
          kind: 'DisplayInfo',
          info: {
            kind: 'AllGoalsWarnings',
            visibleGoals: [{ kind: 'OfType', constraintObj: point(2, 8, 9), type: 'Nat' }],
            invisibleGoals: [],
            warnings: [],
            errors: [],
          },
        },
        { kind: 'End' },
      ],
      [
        { id: 0, from: 4, to: 9 },
        { id: 1, from: 14, to: 19 },
      ],
    );

    await executeGive(ctx, 0, 'suc ?');

    expect(syncToVfs).toHaveBeenCalledTimes(1);
    expect(syncToVfs).toHaveBeenCalledWith(FILE_PATH, doc);
    expect(stream).toHaveBeenCalledTimes(1);
    const cmd = stream.mock.calls[0][0] as IOTCMCommand;
    expect(cmd.raw).toContain('Cmd_give WithoutForce 0');
    expect(cmd.raw).toContain('intervalsToRange');
    expect(cmd.raw).toContain('suc ?');
    expect(view.state.doc.toString()).toBe('a = suc {!   !}\nb = {! !}');
    expect(getGoals(view.state)).toEqual([
      { id: 2, from: 8, to: 15, typeString: 'Nat' },
      { id: 1, from: 20, to: 25 },
    ]);
    const session = getSession(view.state);
    expect(session.busy).toBe(false);
    expect(session.error).toBeUndefined();
    expect(getSession(view.state).checked).toBe(false);
  });

  it('does not touch the backend when the goal id is unknown', async () => {
    const { ctx, syncToVfs, stream } = makeContext('a = {! !}', [], [{ id: 0, from: 4, to: 9 }]);

    await expect(executeGive(ctx, 999, 'x')).rejects.toThrow('999');

    expect(syncToVfs).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('leaves the doc untouched when agda reports an error', async () => {
    const { view, ctx, syncToVfs } = makeContext(
      'a = {! !}',
      [
        {
          kind: 'DisplayInfo',
          info: { kind: 'Error', error: { message: 'no such interaction point' }, warnings: [] },
        },
      ],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeGive(ctx, 0, 'x');

    expect(syncToVfs).toHaveBeenCalledTimes(1);
    expect(getSession(view.state).error).toContain('no such interaction point');
    expect(view.state.doc.toString()).toBe('a = {! !}');
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 9 }]);
  });

  it('leaves the doc untouched when the response set has no GiveAction', async () => {
    const { view, ctx } = makeContext('a = {! !}', [], [{ id: 0, from: 4, to: 9 }]);

    await executeGive(ctx, 0, 'x');

    expect(view.state.doc.toString()).toBe('a = {! !}');
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 9 }]);
    expect(getSession(view.state).error).toBeUndefined();
  });

  it('commits the goal list alone when the give introduces no fresh `?`', async () => {
    // 7-char hole replaced by the 3-char payload → net delta -4; survivor 1
    // is remapped by the goal field and keeps its state position (the
    // response range 99..199 is ignored).
    const doc = 'a = {! x !}\nb = {! y !}';
    const { view, ctx } = makeContext(
      doc,
      [
        { kind: 'GiveAction', interactionPoint: point(0, 4, 11), giveResult: { paren: false } },
        { kind: 'InteractionPoints', interactionPoints: [point(1, 99, 199)] },
        {
          kind: 'DisplayInfo',
          info: {
            kind: 'AllGoalsWarnings',
            visibleGoals: [{ kind: 'OfType', constraintObj: point(1, 99, 199), type: 'Nat' }],
            invisibleGoals: [],
            warnings: [],
            errors: [],
          },
        },
        { kind: 'End' },
      ],
      [
        { id: 0, from: 4, to: 11 },
        { id: 1, from: 15, to: 22 },
      ],
    );

    await executeGive(ctx, 0, ' x ');

    expect(view.state.doc.toString()).toBe('a =  x \nb = {! y !}');
    expect(getGoals(view.state)).toEqual([{ id: 1, from: 11, to: 18, typeString: 'Nat' }]);
  });

  it('drops goals the snapshot no longer reports', async () => {
    // The snapshot reports no remaining goals → both the given goal and the
    // untouched hole are removed from the list (text and list may disagree
    // until the next load reconciles).
    const doc = 'a = {! x !}\nb = {! y !}';
    const { view, ctx } = makeContext(
      doc,
      [
        { kind: 'GiveAction', interactionPoint: point(0, 4, 11), giveResult: { str: 'x' } },
        { kind: 'InteractionPoints', interactionPoints: [] },
        {
          kind: 'DisplayInfo',
          info: {
            kind: 'AllGoalsWarnings',
            visibleGoals: [],
            invisibleGoals: [],
            warnings: [],
            errors: [],
          },
        },
        { kind: 'End' },
      ],
      [
        { id: 0, from: 4, to: 11 },
        { id: 1, from: 15, to: 22 },
      ],
    );

    await executeGive(ctx, 0, ' x ');

    expect(view.state.doc.toString()).toBe('a = x\nb = {! y !}');
    expect(getGoals(view.state)).toEqual([]);
  });
});

describe('syncToVfs (the one vfs-write path every save uses)', () => {
  it('writes the current document and narrates fs::sync info with elapse', async () => {
    const { view, ctx, syncToVfs } = makeContext('module Main where\n', []);

    await expect(ctx.syncToVfs()).resolves.toBe(true);

    expect(syncToVfs).toHaveBeenCalledWith(FILE_PATH, 'module Main where\n');
    const events = getEvents(view.state);
    expect(events).toHaveLength(1);
    expect(events[0]!.level).toBe('info');
    expect(events[0]!.kind).toBe('fs::sync');
    expect(events[0]!.payload).toMatchObject({ elapse: expect.any(String) });
  });

  it('narrates a failed write as fs::sync error, never throws, returns false', async () => {
    const view = makeView('module Main where\n');
    const syncToVfs = vi.fn(async () => {
      throw new Error('fs full');
    });
    const ctx = new ExecuteContext({ syncToVfs, stream: vi.fn(async function* () {}) }, view);

    await expect(ctx.syncToVfs()).resolves.toBe(false);

    const events = getEvents(view.state);
    expect(events).toHaveLength(1);
    expect(events[0]!.level).toBe('error');
    expect(events[0]!.kind).toBe('fs::sync');
    expect(events[0]!.payload).toMatchObject({ error: 'fs full' });
  });
});
