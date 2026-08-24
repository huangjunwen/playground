/**
 * E2E — drive the real command pipeline (load → give → two-spec sync →
 * reload) against the real ALS wasm and a real CM6 EditorState.
 *
 * Verifies the integration the unit tests cannot: the give commit
 * (giveReplacementTransaction, then the sequential expandGoalsTransaction +
 * syncGoals assembly, inlined here as pure state updates) coupled with
 * agda's real response coordinates, and final consistency after a follow-up
 * load.
 *
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
import type { LspTransport, LspTransportMiddleware } from '@playground/lsp';
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

const HOST = '/tmp/opencode/e2e-give';
const WORKSPACE = '/root/workspace';
const FILE = `${WORKSPACE}/Main.agda`;

const SRC = `module Main where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

g1 : Nat
g1 = {! !}

g2 : Nat
g2 = {! !}
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
 * Mimic the command layer's accumulation (executeLoad/executeGive): keep
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

describe('give pipeline end-to-end on real ALS wasm', () => {
  it('load → give "suc ?" → two-transaction sync → reload keeps goals consistent', {
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

    const wire: Array<{ dir: 'c2s' | 's2c'; msg: unknown }> = [];
    const tee: LspTransportMiddleware = inner => {
      const wrapped: LspTransport = {
        send: msg => {
          wire.push({ dir: 'c2s', msg });
          inner.send(msg);
        },
        onMessage: h =>
          inner.onMessage(m => {
            wire.push({ dir: 's2c', msg: m });
            h(m);
          }),
      };
      return wrapped;
    };

    const env = new NodeWasiRunEnv({ preopens });
    const enc = new TextEncoder();
    let doc = SRC;
    await env.fs.writeFile(FILE, enc.encode(doc));
    const handle = await runAls(env, { lspWorkspace: WORKSPACE, onCreateLspTransport: tee });
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
    const { points, typesById } = collect(responses);
    let state = EditorState.create({ doc, extensions: [goalModelField] });
    state = state.update(expandGoalsTransaction(state, syncGoals([], points, typesById))).state;
    let goals = getGoals(state);
    expect(goals).toHaveLength(2);
    const g1From = doc.indexOf('g1 = {!') + 5;
    const g2From = doc.indexOf('g2 = {!') + 5;
    expect(goals.map(g => [g.id, g.from, g.to])).toEqual([
      [0, g1From, g1From + 5],
      [1, g2From, g2From + 5],
    ]);
    expect(goals.every(g => g.typeString === 'Nat')).toBe(true);

    // 2. give g1 "suc ?" — payload = text we will write, range = whole hole span.
    const goal0 = goals.find(g => g.id === 0)!;
    const payload = state.sliceDoc(goal0.from + 2, goal0.to - 2);
    expect(payload).toBe(' ');
    const giveCmd = b.give(0, 'suc ?', { range: span(doc, goal0.from, goal0.to) });
    responses = await run(giveCmd);
    const giveAction = responses.find(r => r.kind === 'GiveAction');
    expect(giveAction?.kind).toBe('GiveAction');
    const giveResult = (giveAction as Extract<AgdaResponse, { kind: 'GiveAction' }>).giveResult;
    expect(giveResult).toMatchObject({ paren: false });

    // The command layer's assembly: replacement spec first, then the sync.
    state = state.update(giveReplacementTransaction(state, goal0, 'suc ?', giveResult)).state;
    expect(state.doc.toString()).toContain('g1 = suc ?');
    const synced = collect(responses);
    state = state.update(
      expandGoalsTransaction(state, syncGoals(getGoals(state), synced.points, synced.typesById)),
    ).state;

    goals = getGoals(state);
    expect(goals).toHaveLength(2);
    // Fresh '?' goals are expanded into '{!   !}' immediately (single-shape
    // holes), so the document no longer contains a bare '?' — the new goal
    // must sit exactly on the expanded hole.
    expect(state.doc.toString()).toContain('g1 = suc {!   !}');
    expect(state.doc.toString()).not.toContain('g1 = suc ?');
    const newQ = state.doc.toString().indexOf('g1 = suc {!') + 9;
    expect(goals.find(g => g.id === 2)?.from).toBe(newQ);
    expect(goals.find(g => g.id === 2)?.typeString).toBe('Nat');
    const g2Remapped = goals.find(g => g.id === 1)!;
    // 'suc ?' (5 chars) replaces the 5-char hole (net delta 0) and the
    // expansion grows the doc by 6 — g2 shifts by exactly +6.
    expect(g2Remapped.from).toBe(g2From + 6);

    // 3. reload — agda renumbers ids; final consistency must match step 2.
    // The load commit sees no bare '?' this time (all holes are already
    // expanded), so g2 stays where the response reports it.
    doc = state.doc.toString();
    await env.fs.writeFile(FILE, enc.encode(doc));
    responses = await run(b.load());
    const done = collect(responses);
    state = state.update(
      expandGoalsTransaction(state, syncGoals([], done.points, done.typesById)),
    ).state;
    expect(done.error).toBeUndefined();
    goals = getGoals(state);
    expect(goals).toHaveLength(2);
    const g2After = state.doc.toString().indexOf('g2 = {!') + 5;
    expect(goals.map(g => [g.id, g.from, g.typeString])).toEqual([
      [0, newQ, 'Nat'],
      [1, g2After, 'Nat'],
    ]);
  });
});
