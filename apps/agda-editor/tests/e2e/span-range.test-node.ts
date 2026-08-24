/**
 * E2E probe — verify the "replacement-span range" hypothesis:
 * if we send range = the exact span the editor will replace, and payload =
 * the exact text the editor will write, then agda's new-point coordinates in
 * the post-give InteractionPoints ARE the real positions in the new document.
 *
 * Commands under test (all with range = whole hole span):
 *   - give "suc ?"         → expect new point at from+4 (payload offset 4)
 *   - give "suc {! !}"     → expect new point block at from+4..from+8 (5 chars)
 *   - intro (λ goal)       → expect new point at from+6 ("λ x → ?" offset 6)
 *   - refine "plus"        → expect GARBAGE (rightMargin) — the exception
 *
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  type AgdaResponse,
  CommandBuilder,
  HIGHLIGHTING_NONE,
  runAls,
} from '@playground/language-backend-agda';
import type { LspTransport, LspTransportMiddleware } from '@playground/lsp';
import { NodeWasiRunEnv } from '@playground/run-env/node';
import { describe, expect, it } from 'vitest';

const HOST = '/tmp/opencode/e2e-span-range';
const WORKSPACE = '/root/workspace';
const FILE = `${WORKSPACE}/Main.agda`;

const SRC = `module Main where

data Nat : Set where
  zero : Nat
  suc  : Nat → Nat

plus : Nat → Nat → Nat
plus zero    m = m
plus (suc n) m = suc (plus n m)

g1 : Nat
g1 = {! !}

g2 : Nat
g2 = {! !}

g3 : Nat → Nat
g3 = {! !}

g4 : Nat → Nat
g4 = {! !}
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

describe('replacement-span range hypothesis', () => {
  it('give/intro positions exact, refine garbage', { timeout: 600_000 }, async () => {
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

    async function run(
      label: string,
      cmd: ReturnType<CommandBuilder['load']>,
    ): Promise<AgdaResponse[]> {
      const out: AgdaResponse[] = [];
      for await (const r of session.stream(cmd)) out.push(r);
      console.log(`=== ${label} ===`);
      for (const r of out) {
        const j = JSON.stringify(r);
        console.log(j.length > 500 ? `${j.slice(0, 500)}…` : j);
      }
      return out;
    }

    const pointsOf = (rs: AgdaResponse[]) =>
      rs.find(r => r.kind === 'InteractionPoints') as
        | {
            kind: 'InteractionPoints';
            interactionPoints: Array<{ id: number; range: Interval1[] }>;
          }
        | undefined;

    const giveActionOf = (rs: AgdaResponse[]) =>
      rs.find(r => r.kind === 'GiveAction') as
        | {
            kind: 'GiveAction';
            interactionPoint: { id: number };
            giveResult: { str?: string; paren?: boolean };
          }
        | undefined;

    const holeSpan = (name: string) => {
      const marker = `${name} = {!`;
      const from = doc.indexOf(marker) + marker.length - 2; // '{' of the hole
      const to = doc.indexOf('!}', from) + 2;
      return { from, to };
    };

    try {
      const rs1 = await run('load', b.load());
      const pts1 = pointsOf(rs1);
      expect(pts1?.interactionPoints).toHaveLength(4);

      const idOf = (name: string): number => {
        const { from } = holeSpan(name);
        const p = pts1?.interactionPoints.find(ip => ip.range[0]?.start.pos === from + 1);
        if (!p) throw new Error(`no point for ${name} @${from + 1}`);
        return p.id;
      };
      // ids known BEFORE each command; the diff = new points created by it.
      // capture all from the pristine doc/load (positions shift as we edit).
      const g1Id = idOf('g1');
      const g2Id = idOf('g2');
      const g3Id = idOf('g3');
      const g4Id = idOf('g4');
      const known = new Set<number>([g1Id, g2Id, g3Id, g4Id]);
      const fresh = (rs: AgdaResponse[]) =>
        pointsOf(rs)?.interactionPoints.filter(ip => !known.has(ip.id));

      // ---- give g1 "suc ?" (range = whole hole span) --------------------
      const g1 = holeSpan('g1');
      const rs2 = await run(
        'give g1 "suc ?" span-range',
        b.give(g1Id, 'suc ?', { range: span(doc, g1.from, g1.to) }),
      );
      expect(giveActionOf(rs2)?.giveResult).toEqual({ paren: false });
      const newPt2 = fresh(rs2);
      expect(newPt2).toHaveLength(1);
      console.log(
        `\n# give g1: agda says new pt = ${JSON.stringify(newPt2![0]!.range)} ; expected 1-based ${g1.from + 5}`,
      );
      expect(newPt2![0]!.range[0]!.start.pos).toBe(g1.from + 5);
      newPt2!.forEach(p => {
        known.add(p.id);
      });
      doc = `${doc.slice(0, g1.from)}suc ?${doc.slice(g1.to)}`;
      await env.fs.writeFile(FILE, enc.encode(doc));

      // ---- give g2 "suc {! !}" (range = whole hole span) ----------------
      const g2 = holeSpan('g2');
      const rs3 = await run(
        'give g2 "suc {! !}" span-range',
        b.give(g2Id, 'suc {! !}', { range: span(doc, g2.from, g2.to) }),
      );
      expect(giveActionOf(rs3)?.giveResult).toEqual({ paren: false });
      const newPts3 = fresh(rs3);
      expect(newPts3).toHaveLength(1);
      console.log(
        `\n# give g2: agda says new pt = ${JSON.stringify(newPts3![0]!.range)} ; expected 1-based [${g2.from + 5}, ${g2.from + 10})`,
      );
      expect(newPts3![0]!.range[0]!.start.pos).toBe(g2.from + 5);
      expect(newPts3![0]!.range[0]!.end.pos).toBe(g2.from + 10);
      newPts3!.forEach(p => {
        known.add(p.id);
      });
      doc = `${doc.slice(0, g2.from)}suc {! !}${doc.slice(g2.to)}`;
      await env.fs.writeFile(FILE, enc.encode(doc));

      // ---- intro g3 (λ goal, range = whole hole span) -------------------
      const g3 = holeSpan('g3');
      const rs4 = await run(
        'intro g3 (span-range)',
        b.intro(g3Id, { pmLambda: false, range: span(doc, g3.from, g3.to) }),
      );
      const ga4 = giveActionOf(rs4);
      console.log(`\n# intro g3: giveResult = ${JSON.stringify(ga4?.giveResult)}`);
      expect(ga4?.giveResult.str).toBe('λ x → ?');
      const newPts4 = fresh(rs4);
      expect(newPts4).toHaveLength(1);
      console.log(
        `# intro g3: agda says new pt = ${JSON.stringify(newPts4![0]!.range)} ; expected 1-based ${g3.from + 7}`,
      );
      expect(newPts4![0]!.range[0]!.start.pos).toBe(g3.from + 7);
      newPts4!.forEach(p => {
        known.add(p.id);
      });
      doc = `${doc.slice(0, g3.from)}λ x → ?${doc.slice(g3.to)}`;
      await env.fs.writeFile(FILE, enc.encode(doc));

      // ---- refine g4 "plus" (range = whole hole span) -------------------
      const g4 = holeSpan('g4');
      const rs5 = await run(
        'refine g4 "plus" span-range',
        b.refine(g4Id, { expr: 'plus', range: span(doc, g4.from, g4.to) }),
      );
      const ga5 = giveActionOf(rs5);
      console.log(`\n# refine g4: giveResult = ${JSON.stringify(ga5?.giveResult)}`);
      expect(ga5?.giveResult.str).toBe('plus ?');
      const newPts5 = fresh(rs5);
      expect(newPts5).toHaveLength(1);
      const realFrom = g4.from + 4; // ? at offset 4 in "plus ?" when applied at g4.from
      console.log(
        `# refine g4: agda says new pt = ${JSON.stringify(newPts5![0]!.range)} ; real 1-based ${realFrom + 1}`,
      );
      expect(newPts5![0]!.range[0]!.start.pos).not.toBe(realFrom + 1);

      console.log('\nALL ASSERTIONS PASSED');
    } finally {
      writeFileSync(`${HOST}/probe-result.json`, JSON.stringify({ wire }, null, 2));
      env.terminate();
      console.log(`dump → ${HOST}/probe-result.json`);
    }
  });
});
