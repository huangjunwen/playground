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
  executeAuto,
  executeCaseOrIntro,
  executeGive,
  executeLoad,
  executeQuery,
  executeRefine,
  executeSolve,
  formatGoalInfo,
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

// ---------------------------------------------------------------------------
// Display queries — goal type / context (C-c C-t, C-c C-e)
// ---------------------------------------------------------------------------

describe('formatGoalInfo', () => {
  it('renders each GoalInfo variant as display lines', () => {
    expect(formatGoalInfo({ kind: 'CurrentGoal', rewrite: 'AsIs', type: 'Nat' })).toEqual([
      'Goal: Nat',
    ]);
    expect(
      formatGoalInfo({
        kind: 'GoalType',
        rewrite: 'AsIs',
        typeAux: { kind: 'GoalOnly' },
        type: 'Nat → Nat',
        entries: [
          { originalName: 'x', reifiedName: 'x', binding: 'x : Nat', inScope: true },
          { originalName: 'y', reifiedName: 'y', binding: 'y : Bool', inScope: false },
        ],
        boundary: [],
        outputForms: [],
      }),
    ).toEqual(['Goal: Nat → Nat', 'x : Nat', 'y : Bool']);
    expect(formatGoalInfo({ kind: 'InferredType', expr: 'Nat' })).toEqual(['Type: Nat']);
    expect(
      formatGoalInfo({ kind: 'NormalForm', computeMode: 'DefaultCompute', expr: 'suc zero' }),
    ).toEqual(['suc zero']);
    expect(formatGoalInfo({ kind: 'HelperFunction', signature: 'go : Nat → Nat' })).toEqual([
      'go : Nat → Nat',
    ]);
  });
});

describe('executeQuery', () => {
  it('streams goal type and context lines into runningInfo, touching nothing else', async () => {
    const { view, ctx, stream } = makeContext(
      'a = {! !}',
      [
        { kind: 'ClearRunningInfo' },
        { kind: 'RunningInfo', debugLevel: 1, message: 'Checking' },
        {
          kind: 'DisplayInfo',
          info: {
            kind: 'GoalSpecific',
            interactionPoint: point(0, 4, 9),
            goalInfo: {
              kind: 'GoalType',
              rewrite: 'AsIs',
              typeAux: { kind: 'GoalOnly' },
              type: 'Nat',
              entries: [{ originalName: 'x', reifiedName: 'x', binding: 'x : Nat', inScope: true }],
              boundary: [],
              outputForms: [],
            },
          },
        },
        { kind: 'End' },
      ],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeQuery(ctx, ctx.builder.goalTypeContext(0, { range: span(view.state.doc, 4, 9) }));

    expect(stream).toHaveBeenCalledTimes(1);
    expect((stream.mock.calls[0][0] as IOTCMCommand).raw).toContain('Cmd_goal_type_context AsIs 0');
    expect(getSession(view.state).runningInfo).toEqual(['Checking', 'Goal: Nat', 'x : Nat']);
    expect(view.state.doc.toString()).toBe('a = {! !}');
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 9 }]);
  });

  it('renders a Context response as its binding lines', async () => {
    const { view, ctx } = makeContext(
      'a = {! !}',
      [
        {
          kind: 'DisplayInfo',
          info: {
            kind: 'Context',
            interactionPoint: point(0, 4, 9),
            context: [
              { originalName: 'x', reifiedName: 'x', binding: 'x : Nat', inScope: true },
              { originalName: 'y', reifiedName: 'y', binding: 'y : Bool', inScope: true },
            ],
          },
        },
        { kind: 'End' },
      ],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeQuery(ctx, ctx.builder.context(0, { range: span(view.state.doc, 4, 9) }));

    expect((ctx as unknown as { view: EditorViewLike }).view).toBe(view); // shape sanity
    expect(getSession(view.state).runningInfo).toEqual(['x : Nat', 'y : Bool']);
  });
});

// ---------------------------------------------------------------------------
// Goal actions — refine / auto / case / solve
// ---------------------------------------------------------------------------

/** AllGoalsWarnings snapshot typing every listed point as Nat. */
const allGoalsSnapshot = (points: InteractionPoint[]): AgdaResponse => ({
  kind: 'DisplayInfo',
  info: {
    kind: 'AllGoalsWarnings',
    visibleGoals: points.map(p => ({ kind: 'OfType', constraintObj: p, type: 'Nat' })),
    invisibleGoals: [],
    warnings: [],
    errors: [],
  },
});

describe('executeRefine', () => {
  it('commits the refined hole like a give, with fresh goals from the snapshot', async () => {
    const doc = 'a = {! !}\nb = {! !}';
    const { view, ctx, stream } = makeContext(
      doc,
      [
        { kind: 'GiveAction', interactionPoint: point(0, 4, 9), giveResult: { str: 'λ x → ?' } },
        // New-doc coordinates: the `?` inside `λ x → ?` sits at [10, 11).
        {
          kind: 'InteractionPoints',
          interactionPoints: [point(2, 10, 11), point(1, 16, 21)],
        },
        allGoalsSnapshot([point(2, 10, 11), point(1, 16, 21)]),
        { kind: 'End' },
      ],
      [
        { id: 0, from: 4, to: 9 },
        { id: 1, from: 14, to: 19 },
      ],
    );

    await executeRefine(ctx, 0);

    expect(stream).toHaveBeenCalledTimes(1);
    expect((stream.mock.calls[0][0] as IOTCMCommand).raw).toContain('Cmd_refine 0');
    expect(view.state.doc.toString()).toBe('a = λ x → {!   !}\nb = {! !}');
    // Survivor shifts twice: +2 for the hole→`λ x → ?` replacement, +6 more
    // when goal 2's `?` expands into a full hole (16+6, 21+6).
    expect(getGoals(view.state)).toEqual([
      { id: 2, from: 10, to: 17, typeString: 'Nat' },
      { id: 1, from: 22, to: 27, typeString: 'Nat' },
    ]);
    expect(getSession(view.state).busy).toBe(false);
  });

  it('does not touch the backend when the goal id is unknown', async () => {
    const { ctx, syncToVfs, stream } = makeContext('a = {! !}', [], [{ id: 0, from: 4, to: 9 }]);

    await expect(executeRefine(ctx, 999)).rejects.toThrow('999');

    expect(syncToVfs).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('leaves the doc untouched when agda reports an error', async () => {
    const { view, ctx } = makeContext(
      'a = {! !}',
      [errorResponse('cannot refine')],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeRefine(ctx, 0);

    expect(getSession(view.state).error).toContain('cannot refine');
    expect(view.state.doc.toString()).toBe('a = {! !}');
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 9 }]);
  });
});

describe('executeAuto', () => {
  it('commits a GiveAction hit like a give', async () => {
    const { view, ctx, stream } = makeContext(
      'a = {! !}',
      [
        { kind: 'GiveAction', interactionPoint: point(0, 4, 9), giveResult: { str: 'suc zero' } },
        { kind: 'InteractionPoints', interactionPoints: [] },
        allGoalsSnapshot([]),
        { kind: 'End' },
      ],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeAuto(ctx, 0);

    expect(stream).toHaveBeenCalledTimes(1);
    expect((stream.mock.calls[0][0] as IOTCMCommand).raw).toContain('Cmd_autoOne AsIs 0');
    expect(view.state.doc.toString()).toBe('a = suc zero');
    expect(getGoals(view.state)).toEqual([]);
  });

  it('commits a Mimer solution when no GiveAction arrived', async () => {
    const { view, ctx } = makeContext(
      'a = {! !}',
      [
        { kind: 'Mimer', solution: 'zero' },
        { kind: 'InteractionPoints', interactionPoints: [] },
        allGoalsSnapshot([]),
        { kind: 'End' },
      ],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeAuto(ctx, 0);

    expect(view.state.doc.toString()).toBe('a = zero');
    expect(getGoals(view.state)).toEqual([]);
  });

  it('narrates a miss through the Auto info lines and changes nothing', async () => {
    const { view, ctx } = makeContext(
      'a = {! !}',
      [
        { kind: 'Mimer', solution: null },
        { kind: 'DisplayInfo', info: { kind: 'Auto', info: 'No solution found' } },
        { kind: 'End' },
      ],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeAuto(ctx, 0);

    expect(getSession(view.state).runningInfo).toEqual(['No solution found']);
    expect(view.state.doc.toString()).toBe('a = {! !}');
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 9 }]);
  });
});

describe('executeCaseOrIntro', () => {
  it('case-splits the hole and reloads so the fresh clauses register their goals', async () => {
    // The stream answers by command: the split, then the follow-up load.
    const view = makeView('a = {! n !}');
    view.dispatch({ effects: [setGoals.of([{ id: 0, from: 4, to: 11 }])] });
    const syncToVfs = vi.fn(async () => {});
    const stream = vi.fn(async function* (cmd: IOTCMCommand) {
      if (cmd.kind === 'Cmd_make_case') {
        yield {
          kind: 'MakeCase',
          interactionPoint: point(0, 4, 11),
          variant: 'Function',
          clauses: ['f zero = ?', 'f (suc n) = ?'],
        } as AgdaResponse;
        yield { kind: 'End' } as AgdaResponse;
        return;
      }
      // Clauses land as: 'a = f zero = ?\nf (suc n) = ?' — the two `?`
      // sit at [13, 14) and [27, 28).
      yield* loadResponses([point(0, 13, 14), point(1, 27, 28)]);
    });
    const ctx = new ExecuteContext({ syncToVfs, stream }, view);

    await executeCaseOrIntro(ctx, 0, 'n');

    expect(stream).toHaveBeenCalledTimes(2);
    expect((stream.mock.calls[0][0] as IOTCMCommand).kind).toBe('Cmd_make_case');
    expect((stream.mock.calls[0][0] as IOTCMCommand).raw).toContain('"n"');
    expect((stream.mock.calls[1][0] as IOTCMCommand).kind).toBe('Cmd_load');
    expect(syncToVfs).toHaveBeenCalledTimes(2);
    expect(view.state.doc.toString()).toBe('a = f zero = {!   !}\nf (suc n) = {!   !}');
    // Each load-time `?`→hole expansion shifts the later goal by +6.
    expect(getGoals(view.state)).toEqual([
      { id: 0, from: 13, to: 20, typeString: 'Nat' },
      { id: 1, from: 33, to: 40, typeString: 'Nat' },
    ]);
  });

  it('leaves the doc untouched on a failed split, without the reload', async () => {
    const view = makeView('a = {! n !}');
    view.dispatch({ effects: [setGoals.of([{ id: 0, from: 4, to: 11 }])] });
    const syncToVfs = vi.fn(async () => {});
    const stream = vi.fn(async function* (cmd: IOTCMCommand) {
      if (cmd.kind === 'Cmd_make_case') {
        yield errorResponse('cannot split');
        yield { kind: 'End' } as AgdaResponse;
      }
    });
    const ctx = new ExecuteContext({ syncToVfs, stream }, view);

    await executeCaseOrIntro(ctx, 0, 'n');

    expect(stream).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe('a = {! n !}');
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 11 }]);
  });

  it('intros an empty goal through refineOrIntro and commits like a give', async () => {
    // '{!  !}' — hole [4, 10), trimmed interior is empty → intro path.
    const { view, ctx, stream } = makeContext(
      'a = {!  !}',
      [
        { kind: 'GiveAction', interactionPoint: point(0, 4, 10), giveResult: { str: 'λ x → ?' } },
        { kind: 'InteractionPoints', interactionPoints: [point(1, 10, 11)] },
        allGoalsSnapshot([point(1, 10, 11)]),
        { kind: 'End' },
      ],
      [{ id: 0, from: 4, to: 10 }],
    );

    await executeCaseOrIntro(ctx, 0, '');

    expect(stream).toHaveBeenCalledTimes(1);
    expect((stream.mock.calls[0][0] as IOTCMCommand).raw).toContain('Cmd_refine_or_intro');
    expect(view.state.doc.toString()).toBe('a = λ x → {!   !}');
    expect(getGoals(view.state)).toEqual([{ id: 1, from: 10, to: 17, typeString: 'Nat' }]);
  });

  it('narrates IntroNotFound and leaves the doc untouched', async () => {
    const { view, ctx } = makeContext(
      'a = {!  !}',
      [{ kind: 'DisplayInfo', info: { kind: 'IntroNotFound' } }, { kind: 'End' }],
      [{ id: 0, from: 4, to: 10 }],
    );

    await executeCaseOrIntro(ctx, 0, '');

    expect(getSession(view.state).runningInfo).toEqual(['intro: no introduction form found']);
    expect(view.state.doc.toString()).toBe('a = {!  !}');
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 10 }]);
  });
});

describe('executeSolve', () => {
  it('replaces the hole with the instantiation and drops the goal', async () => {
    const doc = 'a = {! x !}\nb = {! y !}';
    const { view, ctx, stream } = makeContext(
      doc,
      [
        { kind: 'SolveAll', solutions: [{ interactionPoint: 0, expression: 'suc zero' }] },
        { kind: 'End' },
      ],
      [
        { id: 0, from: 4, to: 11 },
        { id: 1, from: 16, to: 23 },
      ],
    );

    await executeSolve(ctx, 0);

    expect(stream).toHaveBeenCalledTimes(1);
    expect((stream.mock.calls[0][0] as IOTCMCommand).raw).toContain('Cmd_solveOne AsIs 0');
    expect(view.state.doc.toString()).toBe('a = suc zero\nb = {! y !}');
    expect(getGoals(view.state)).toEqual([{ id: 1, from: 17, to: 24 }]);
  });

  it('warns and changes nothing when the goal has no instantiation', async () => {
    const { view, ctx } = makeContext(
      'a = {! !}',
      [{ kind: 'SolveAll', solutions: [] }, { kind: 'End' }],
      [{ id: 0, from: 4, to: 9 }],
    );

    await executeSolve(ctx, 0);

    expect(view.state.doc.toString()).toBe('a = {! !}');
    expect(getGoals(view.state)).toEqual([{ id: 0, from: 4, to: 9 }]);
    const events = getEvents(view.state);
    const warn = events.find(e => e.kind === 'Cmd_solveOne::noSolution');
    expect(warn).toMatchObject({ level: 'warn', payload: { goalId: 0 } });
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
