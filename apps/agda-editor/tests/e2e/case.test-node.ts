/**
 * E2E — drive the case pipeline (load → make-case → replacement commit →
 * chained reload) against the real ALS wasm and a real CM6 EditorState.
 *
 * Verifies the integration the unit tests cannot: the MakeCase wire
 * response (probe-observed: clauses are full clause lines from column 0
 * with bare `?` markers) coupled with caseReplacementTransaction's clause
 * replacement, and final consistency after the chained load that turns
 * the clauses' `?`s into renumbered, expanded goals.
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
  caseReplacementTransaction,
  expandGoalsTransaction,
  getGoals,
  goalModelField,
  syncGoals,
} from '../../src/model/goal-model';

const HOST = '/tmp/opencode/e2e-case';
const WORKSPACE = '/root/workspace';
const FILE = `${WORKSPACE}/Main.agda`;

const SRC = `module Main where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

plus : Nat → Nat → Nat
plus n m = {! n !}
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
 * Mimic the command layer's accumulation (executeLoad/executeCase): keep
 * only the goal payload and the failure flag, never the raw stream.
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

describe('case pipeline end-to-end on real ALS wasm', () => {
  it('load → case "n" → clause replacement → chained reload keeps goals consistent', {
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
    expect([goal.id, goal.from, goal.to, goal.typeString]).toEqual([
      0,
      holeFrom,
      holeFrom + 7,
      'Nat', // the goal is plus's clause RHS, not the whole signature
    ]);

    // 2. case on an unsplitable variable — agda answers an error, no
    // MakeCase; nothing is committed (the common error path).
    responses = await run(b.case(0, 'zzz', { range: span(doc, goal.from, goal.to) }));
    expect(responses.some(r => r.kind === 'MakeCase')).toBe(false);
    expect(collect(responses).error).toBeDefined();

    // 3. case "n" — payload = the hole's interior, range = whole hole.
    responses = await run(b.case(0, 'n', { range: span(doc, goal.from, goal.to) }));
    const makeCase = responses.find(r => r.kind === 'MakeCase') as Extract<
      AgdaResponse,
      { kind: 'MakeCase' }
    >;
    // Probe-observed wire: full clause lines from column 0, `?` markers.
    expect(makeCase?.variant).toBe('Function');
    expect(makeCase?.clauses).toEqual(['plus zero m = ?', 'plus (suc n) m = ?']);

    // The command layer's commit: the replacement (the InteractionPoints
    // echoed alongside are stale — the vfs still holds the pre-split text).
    state = state.update(
      caseReplacementTransaction(state, goal, makeCase.variant, makeCase.clauses),
    ).state;
    doc = state.doc.toString();
    expect(doc).toContain('plus zero m = ?');
    expect(doc).toContain('plus (suc n) m = ?');
    expect(getGoals(state)).toEqual([]);

    // 4. chained load — renumbers ids, expands the clauses' `?`s into
    // holes, refreshes the diagnostics. Final consistency.
    await env.fs.writeFile(FILE, enc.encode(doc));
    responses = await run(b.load());
    loaded = collect(responses);
    expect(loaded.error).toBeUndefined();
    state = state.update(
      expandGoalsTransaction(state, syncGoals([], loaded.points, loaded.typesById)),
    ).state;

    goals = getGoals(state);
    doc = state.doc.toString();
    expect(goals.map(g => [g.id, g.typeString])).toEqual([
      [0, 'Nat'],
      [1, 'Nat'],
    ]);
    const firstHole = doc.indexOf('plus zero m = {!') + 'plus zero m = '.length;
    const secondHole = doc.indexOf('plus (suc n) m = {!') + 'plus (suc n) m = '.length;
    expect(goals.map(g => [g.from, g.to])).toEqual([
      [firstHole, firstHole + 7],
      [secondHole, secondHole + 7],
    ]);
    expect(doc).toContain('plus zero m = {!   !}');
    expect(doc).toContain('plus (suc n) m = {!   !}');
  });
});
