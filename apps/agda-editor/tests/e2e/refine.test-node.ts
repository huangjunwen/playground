/**
 * E2E — drive the refine pipeline (load → refine-or-intro → replacement
 * commit → chained reload) against the real ALS wasm and a real CM6
 * EditorState.
 *
 * Verifies the integration the unit tests cannot: the GiveAction wire
 * response (probe-observed: the reified term with bare `?` markers for the
 * appended subgoals) coupled with giveReplacementTransaction's hole
 * replacement, and final consistency after the chained load that turns the
 * appended `?` into a renumbered, expanded goal — refine's own echoed
 * InteractionPoints are bogus (their ranges collapse onto the old hole's
 * right margin) and are deliberately ignored.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import {
  type AgdaResponse,
  CommandBuilder,
  collectVisibleGoalTypes,
  HIGHLIGHTING_NONE,
  type InteractionPoint,
  runAls,
} from '@playground/language-backend-agda';
import { NodeWasiRunEnv } from '@playground/run-env/node';
import { describe, expect, it } from 'vitest';
import { responseDispatcher } from '../../src/integration/commands';
import {
  expandGoalsTransaction,
  getGoals,
  giveReplacementTransaction,
  goalModelField,
  syncGoals,
} from '../../src/model/goal-model';

const HOST = '/tmp/opencode/e2e-refine';
const WORKSPACE = '/root/workspace';
const FILE = `${WORKSPACE}/Main.agda`;

const SRC = `module Main where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

plus : Nat → Nat → Nat
plus n m = {! !}
`;

interface Position1 {
  pos: number;
  line: number;
  col: number;
}
interface Interval1 {
  start: Position1;
  end: Position1;
}

function posAt(text: string, idx0: number): Position1 {
  const before = text.slice(0, idx0);
  const line = (before.match(/\n/g)?.length ?? 0) + 1;
  const lastNl = before.lastIndexOf('\n');
  return { pos: idx0 + 1, line, col: idx0 - lastNl };
}

function span(text: string, from0: number, to0: number): Interval1[] {
  return [{ start: posAt(text, from0), end: posAt(text, to0) }];
}

/**
 * Mimic the command layer's accumulation (executeLoad/executeRefine):
 * keep only the goal payload and the failure flag, never the raw stream.
 */
function collect(responses: AgdaResponse[]) {
  let points: InteractionPoint[] | undefined;
  let typesById: Map<number, string> | undefined;
  let error: string | undefined;
  const dispatch = responseDispatcher({
    InteractionPoints: ({ interactionPoints }) => {
      points = points ?? [];
      points.push(...interactionPoints);
    },
    DisplayInfo: {
      AllGoalsWarnings: ({ visibleGoals }) => {
        typesById = collectVisibleGoalTypes(visibleGoals);
      },
      Error: ({ error: err }) => {
        error ??= err.message;
      },
    },
  });
  for (const r of responses) dispatch(r);
  return { points, typesById, error };
}

describe('refine pipeline end-to-end on real ALS wasm', () => {
  it('load → refine "suc" → hole replacement → chained reload keeps goals consistent', {
    timeout: 600_000,
  }, async () => {
    rmSync(HOST, { recursive: true, force: true });
    const preopens: Record<string, string> = {
      '/': HOST,
      '/tmp': `${HOST}/tmp`,
      '/data/builtins/als-wasm-v6-opt': `${HOST}/data/builtins`,
    };
    for (const d of [`${HOST}/tmp`, `${HOST}/data/builtins`, `${HOST}/root/workspace`]) {
      mkdirSync(d, { recursive: true });
    }

    const env = new NodeWasiRunEnv({ preopens });
    const enc = new TextEncoder();
    let doc = SRC;
    await env.fs.writeFile(FILE, enc.encode(doc));
    const handle = await runAls(env, { lspWorkspace: WORKSPACE });
    const b = new CommandBuilder(FILE, { highlightingLevel: HIGHLIGHTING_NONE });
    const session = handle.session;

    async function run(cmd: ReturnType<CommandBuilder['load']>): Promise<AgdaResponse[]> {
      const out: AgdaResponse[] = [];
      for await (const r of session.stream(cmd)) out.push(r);
      return out;
    }

    // 1. load — sync the goal list from scratch (the load commit, inlined
    // from executeLoad: rebuild + expand in one transaction).
    let responses = await run(b.load());
    let loaded = collect(responses);
    expect(loaded.error).toBeUndefined();
    let state = EditorState.create({ doc, extensions: [goalModelField] });
    state = state.update(
      expandGoalsTransaction(state, syncGoals([], loaded.points, loaded.typesById)),
    ).state;
    let goals = getGoals(state);
    expect(goals).toHaveLength(1);
    const goal = goals[0]!;
    const holeFrom = doc.indexOf('{!');
    const holeTo = doc.indexOf('!}', holeFrom) + 2;
    expect([goal.id, goal.from, goal.to, goal.typeString]).toEqual([0, holeFrom, holeTo, 'Nat']);

    // 2. refine a nonsense term — agda answers an error, no GiveAction;
    // nothing is committed (the common error path).
    responses = await run(
      b.refineOrIntro(0, { expr: 'zzz', range: span(doc, goal.from, goal.to) }),
    );
    expect(responses.some(r => r.kind === 'GiveAction')).toBe(false);
    expect(collect(responses).error).toBeDefined();

    // 3. refine "suc" — payload = the hole's interior, range = whole hole.
    //    suc's argument cannot be inferred, so agda appends a `?` and
    //    answers the reified term (probe-observed wire: 'suc ?').
    responses = await run(
      b.refineOrIntro(0, { expr: 'suc', range: span(doc, goal.from, goal.to) }),
    );
    const give = responses.find(r => r.kind === 'GiveAction') as Extract<
      AgdaResponse,
      { kind: 'GiveAction' }
    >;
    expect(give?.giveResult).toEqual({ str: 'suc ?' });

    // The command layer's commit: the replacement (the InteractionPoints
    // echoed alongside are bogus — the appended `?` is not in the vfs yet,
    // its range collapses onto the old hole's right margin).
    state = state.update(giveReplacementTransaction(state, goal, 'suc', give.giveResult)).state;
    doc = state.doc.toString();
    expect(doc).toContain('plus n m = suc ?');
    expect(getGoals(state)).toEqual([]);

    // 4. chained load — renumbers ids, expands the appended `?` into a
    // hole, refreshes the diagnostics. Final consistency.
    await env.fs.writeFile(FILE, enc.encode(doc));
    responses = await run(b.load());
    loaded = collect(responses);
    expect(loaded.error).toBeUndefined();
    state = state.update(
      expandGoalsTransaction(state, syncGoals([], loaded.points, loaded.typesById)),
    ).state;

    goals = getGoals(state);
    doc = state.doc.toString();
    expect(goals.map(g => [g.id, g.typeString])).toEqual([[0, 'Nat']]);
    const freshHole = doc.indexOf('suc {!') + 'suc '.length;
    expect(goals.map(g => [g.from, g.to])).toEqual([[freshHole, freshHole + 7]]);
    expect(doc).toContain('plus n m = suc {!   !}');
  });
});
