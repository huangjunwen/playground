/** Unit tests for parseAgdaResponse — wire shapes against native kind-based AgdaResponse. */

import { describe, expect, it } from 'vitest';
import { parseAgdaResponse } from '../../src/protocol/parser';

// ---- Malformed / Unknown ----

describe('Malformed / Unknown', () => {
  it('returns Unknown for null', () => expect(parseAgdaResponse(null).kind).toBe('Unknown'));
  it('returns Unknown for non-object string', () =>
    expect(parseAgdaResponse('bad').kind).toBe('Unknown'));
  it('returns Unknown for object without tag', () =>
    expect(parseAgdaResponse({}).kind).toBe('Unknown'));
  it('returns Unknown for unknown tag', () =>
    expect(parseAgdaResponse({ tag: 'BadTag' }).kind).toBe('Unknown'));
  it('returns Unknown when ResponseJSONRaw contents is not an object', () =>
    expect(parseAgdaResponse({ tag: 'ResponseJSONRaw', contents: 'bad' }).kind).toBe('Unknown'));
  it('returns Unknown when ResponseJSONRaw inner has no kind', () =>
    expect(parseAgdaResponse({ tag: 'ResponseJSONRaw', contents: { x: 1 } }).kind).toBe('Unknown'));
  it('returns Unknown for unknown inner kind', () =>
    expect(parseAgdaResponse({ tag: 'ResponseJSONRaw', contents: { kind: 'BadKind' } }).kind).toBe(
      'Unknown',
    ));
});

// ---- End sentinel (bare, not wrapped in ResponseJSONRaw) ----

describe('End sentinel', () => {
  it('returns End for bare ResponseEnd tag', () =>
    expect(parseAgdaResponse({ tag: 'ResponseEnd' }).kind).toBe('End'));
  it('returns End for ResponseEnd with null contents', () => {
    const r = parseAgdaResponse({ tag: 'ResponseEnd', contents: null });
    expect(r.kind).toBe('End');
  });
});

// ---- Status ----

describe('Status', () => {
  it('parses Status with all fields', () => {
    const r = parseAgdaResponse({
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'Status',
        status: { showImplicitArguments: false, showIrrelevantArguments: false, checked: true },
      },
    });
    expect(r.kind).toBe('Status');
    if (r.kind !== 'Status') throw new Error('wrong kind');
    expect(r.status.showImplicitArguments).toBe(false);
    expect(r.status.showIrrelevantArguments).toBe(false);
    expect(r.status.checked).toBe(true);
  });
});

// ---- InteractionPoints ----

describe('InteractionPoints', () => {
  it('parses InteractionPoints with ranges', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'InteractionPoints',
        interactionPoints: [
          {
            id: 0,
            range: [{ start: { pos: 10, line: 5, col: 3 }, end: { pos: 12, line: 5, col: 5 } }],
          },
        ],
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('InteractionPoints');
    if (r.kind !== 'InteractionPoints') throw new Error('wrong kind');
    expect(r.interactionPoints).toHaveLength(1);
    expect(r.interactionPoints[0].id).toBe(0);
    expect(r.interactionPoints[0].range).toHaveLength(1);
    expect(r.interactionPoints[0].range[0].start.col).toBe(3);
    expect(r.interactionPoints[0].range[0].end.col).toBe(5);
  });

  it('parses noRange with empty array', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'InteractionPoints', interactionPoints: [{ id: 1, range: [] }] },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('InteractionPoints');
    if (r.kind !== 'InteractionPoints') throw new Error('wrong kind');
    expect(r.interactionPoints[0].range).toHaveLength(0);
  });
});

// ---- DisplayInfo / AllGoalsWarnings ----

describe('DisplayInfo / AllGoalsWarnings', () => {
  it('parses AllGoalsWarnings with visible OfType goal carrying range', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'AllGoalsWarnings',
          visibleGoals: [
            {
              kind: 'OfType',
              constraintObj: {
                id: 0,
                range: [{ start: { pos: 10, line: 5, col: 3 }, end: { pos: 12, line: 5, col: 5 } }],
              },
              type: 'Set',
            },
          ],
          invisibleGoals: [],
          warnings: [],
          errors: [],
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('AllGoalsWarnings');
    if (r.info.kind !== 'AllGoalsWarnings') throw new Error('wrong info kind');
    expect(r.info.visibleGoals).toHaveLength(1);
    const goal = r.info.visibleGoals[0];
    expect(goal.kind).toBe('OfType');
    if (goal.kind !== 'OfType' || !('constraintObj' in goal)) throw new Error('not OfType');
    expect(goal.type).toBe('Set');
    expect((goal.constraintObj as { id: number; range: unknown[] }).id).toBe(0);
    expect((goal.constraintObj as { id: number; range: unknown[] }).range).toHaveLength(1);
    expect(r.info.warnings).toHaveLength(0);
    expect(r.info.errors).toHaveLength(0);
  });
});

// ---- DisplayInfo / GoalSpecific (GoalType) ----

describe('DisplayInfo / GoalSpecific', () => {
  it('parses GoalSpecific GoalType', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'GoalSpecific',
          interactionPoint: { id: 0, range: [] },
          goalInfo: {
            kind: 'GoalType',
            rewrite: 'AsIs',
            typeAux: { kind: 'GoalOnly' },
            type: 'Set',
            entries: [],
            boundary: [],
            outputForms: [],
          },
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('GoalSpecific');
    if (r.info.kind !== 'GoalSpecific') throw new Error('wrong info kind');
    expect(r.info.goalInfo.kind).toBe('GoalType');
    if (r.info.goalInfo.kind !== 'GoalType') throw new Error('wrong goal info kind');
    expect(r.info.goalInfo.type).toBe('Set');
    expect(r.info.goalInfo.typeAux.kind).toBe('GoalOnly');
  });
});

// ---- DisplayInfo / Error ----

describe('DisplayInfo / Error', () => {
  it('parses DisplayInfo Error', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: { kind: 'Error', error: { message: 'Parse error' }, warnings: [] },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('Error');
    if (r.info.kind !== 'Error') throw new Error('wrong info kind');
    expect(r.info.error.message).toBe('Parse error');
  });
});

// ---- DisplayInfo / NormalForm ----

describe('DisplayInfo / NormalForm', () => {
  it('parses NormalForm with pretty string expr', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'NormalForm',
          commandState: { interactionPoints: [], currentFile: null },
          computeMode: 'DefaultCompute',
          time: null,
          expr: 'zero',
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('NormalForm');
    if (r.info.kind !== 'NormalForm') throw new Error('wrong info kind');
    expect(r.info.expr).toBe('zero');
    expect(r.info.computeMode).toBe('DefaultCompute');
  });
});

// ---- DisplayInfo / CompilationOk ----

describe('DisplayInfo / CompilationOk', () => {
  it('parses CompilationOk', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: { kind: 'CompilationOk', backend: 'LaTeX', warnings: [], errors: [] },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('CompilationOk');
    if (r.info.kind !== 'CompilationOk') throw new Error('wrong info kind');
    expect(r.info.backend).toBe('LaTeX');
  });
});

// ---- GiveAction (3 shapes by key presence) ----

describe('GiveAction', () => {
  it('parses GiveAction with {str}', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'GiveAction',
        interactionPoint: { id: 0, range: [] },
        giveResult: { str: 'zero' },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('GiveAction');
    if (r.kind !== 'GiveAction') throw new Error('wrong kind');
    expect('str' in r.giveResult).toBe(true);
    if ('str' in r.giveResult) expect(r.giveResult.str).toBe('zero');
  });
  it('parses GiveAction with {paren:true}', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'GiveAction',
        interactionPoint: { id: 0, range: [] },
        giveResult: { paren: true },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('GiveAction');
    if (r.kind !== 'GiveAction') throw new Error('wrong kind');
    if ('paren' in r.giveResult) expect(r.giveResult.paren).toBe(true);
  });
  it('parses GiveAction with {paren:false}', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'GiveAction',
        interactionPoint: { id: 0, range: [] },
        giveResult: { paren: false },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('GiveAction');
    if (r.kind !== 'GiveAction') throw new Error('wrong kind');
    if ('paren' in r.giveResult) expect(r.giveResult.paren).toBe(false);
  });
});

// ---- MakeCase (variant-merged: Function and ExtendedLambda) ----

describe('MakeCase', () => {
  it('parses MakeCase Function variant', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'MakeCase',
        interactionPoint: { id: 0, range: [] },
        variant: 'Function',
        clauses: ['zero'],
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('MakeCase');
    if (r.kind !== 'MakeCase') throw new Error('wrong kind');
    expect(r.variant).toBe('Function');
    expect(r.clauses).toEqual(['zero']);
  });
  it('parses MakeCase ExtendedLambda variant', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'MakeCase',
        interactionPoint: { id: 0, range: [] },
        variant: 'ExtendedLambda',
        clauses: [''],
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('MakeCase');
    if (r.kind !== 'MakeCase') throw new Error('wrong kind');
    expect(r.variant).toBe('ExtendedLambda');
  });
});

// ---- SolveAll (bare int interactionPoint) ----

describe('SolveAll', () => {
  it('parses SolveAll with bare-int interactionPoint', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'SolveAll',
        solutions: [
          { interactionPoint: 0, expression: 'zero' },
          { interactionPoint: 1, expression: 'suc zero' },
        ],
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('SolveAll');
    if (r.kind !== 'SolveAll') throw new Error('wrong kind');
    expect(r.solutions).toHaveLength(2);
    expect(r.solutions[0].interactionPoint).toBe(0);
    expect(r.solutions[0].expression).toBe('zero');
    expect(r.solutions[1].interactionPoint).toBe(1);
  });
});

// ---- JumpToError ----

describe('JumpToError', () => {
  it('parses JumpToError', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'JumpToError', filepath: '/root/workspace/Main.agda', position: 115 },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('JumpToError');
    if (r.kind !== 'JumpToError') throw new Error('wrong kind');
    expect(r.filepath).toBe('/root/workspace/Main.agda');
    expect(r.position).toBe(115);
  });
});

// ---- HighlightingInfo ----

describe('HighlightingInfo', () => {
  it('parses HighlightingInfo direct with named payload atoms', () => {
    const atom = {
      range: [1, 5],
      atoms: ['hole'],
      tokenBased: 'TokenBased',
      note: '',
      definitionSite: null,
    };
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'HighlightingInfo',
        direct: true,
        info: { remove: false, payload: [atom] },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('HighlightingInfo');
    if (r.kind !== 'HighlightingInfo') throw new Error('wrong kind');
    expect(r.direct).toBe(true);
    if (!r.direct) throw new Error('not direct');
    expect(r.info.remove).toBe(false);
    expect(r.info.payload).toHaveLength(1);
    expect(r.info.payload[0].atoms).toEqual(['hole']);
    expect(r.info.payload[0].tokenBased).toBe('TokenBased');
    expect(r.info.payload[0].range).toEqual([1, 5]);
  });
  it('parses HighlightingInfo indirect with filepath', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'HighlightingInfo', direct: false, filepath: '/tmp/highlight.json' },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('HighlightingInfo');
    if (r.kind !== 'HighlightingInfo') throw new Error('wrong kind');
    expect(r.direct).toBe(false);
    if (r.direct) throw new Error('not indirect');
    expect(r.filepath).toBe('/tmp/highlight.json');
  });
  it('parses HighlightingInfo atom with definitionSite', () => {
    const atom = {
      range: [10, 20],
      atoms: ['symbol'],
      tokenBased: 'NotOnlyTokenBased',
      note: 'some note',
      definitionSite: { filepath: '/root/workspace/Lib.agda', position: 42 },
    };
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'HighlightingInfo', direct: true, info: { remove: true, payload: [atom] } },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('HighlightingInfo');
    if (r.kind !== 'HighlightingInfo') throw new Error('wrong kind');
    if (!r.direct) throw new Error('not direct');
    const a = r.info.payload[0];
    expect(a.note).toBe('some note');
    expect(a.definitionSite).toEqual({ filepath: '/root/workspace/Lib.agda', position: 42 });
  });
});

// ---- ClearHighlighting / ClearRunningInfo / RunningInfo ----

describe('ClearHighlighting / ClearRunningInfo / RunningInfo', () => {
  it('parses ClearHighlighting TokenBased', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'ClearHighlighting', tokenBased: 'TokenBased' },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('ClearHighlighting');
    if (r.kind !== 'ClearHighlighting') throw new Error('wrong kind');
    expect(r.tokenBased).toBe('TokenBased');
  });
  it('parses ClearRunningInfo', () => {
    const r = parseAgdaResponse({ tag: 'ResponseJSONRaw', contents: { kind: 'ClearRunningInfo' } });
    expect(r.kind).toBe('ClearRunningInfo');
  });
  it('parses RunningInfo', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'RunningInfo', debugLevel: 1, message: 'checking Main' },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('RunningInfo');
    if (r.kind !== 'RunningInfo') throw new Error('wrong kind');
    expect(r.debugLevel).toBe(1);
    expect(r.message).toBe('checking Main');
  });
});

// ---- Terminal sentinels ----

describe('Terminal sentinels', () => {
  it('parses DoneExiting', () => {
    const r = parseAgdaResponse({ tag: 'ResponseJSONRaw', contents: { kind: 'DoneExiting' } });
    expect(r.kind).toBe('DoneExiting');
  });
  it('parses DoneAborting', () => {
    const r = parseAgdaResponse({ tag: 'ResponseJSONRaw', contents: { kind: 'DoneAborting' } });
    expect(r.kind).toBe('DoneAborting');
  });
});

// ---- Mimer ----

describe('Mimer', () => {
  it('parses Mimer with solution string', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'Mimer', solution: 'zero' },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('Mimer');
    if (r.kind !== 'Mimer') throw new Error('wrong kind');
    expect(r.solution).toBe('zero');
  });
  it('parses Mimer with null solution', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'Mimer', solution: null },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('Mimer');
    if (r.kind !== 'Mimer') throw new Error('wrong kind');
    expect(r.solution).toBeNull();
  });
});

// ---- DisplayInfo leaf variants ----

describe('DisplayInfo leaf variants', () => {
  it('parses Version', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'DisplayInfo', info: { kind: 'Version', version: 'Agda version 2.7.0' } },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('Version');
  });
  it('parses Auto', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'DisplayInfo', info: { kind: 'Auto', info: 'No solutions found' } },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('Auto');
  });
  it('parses DisplayInfo Time', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'DisplayInfo', info: { kind: 'Time', time: '1.23s' } },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('Time');
  });
  it('parses InferredType', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'InferredType',
          commandState: { interactionPoints: [], currentFile: null },
          time: null,
          expr: 'Nat',
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('InferredType');
  });
  it('parses Context with entries', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'Context',
          interactionPoint: { id: 0, range: [] },
          context: [{ originalName: 'n', reifiedName: 'n', binding: 'Nat', inScope: true }],
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('Context');
    if (r.info.kind !== 'Context') throw new Error('wrong info kind');
    expect(r.info.context).toHaveLength(1);
    expect(r.info.context[0].binding).toBe('Nat');
    expect(r.info.context[0].inScope).toBe(true);
  });
  it('parses Constraints', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'DisplayInfo', info: { kind: 'Constraints', constraints: ['c1', 'c2'] } },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('Constraints');
  });
  it('parses ModuleContents', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'ModuleContents',
          contents: [],
          telescope: null,
          names: ['foo', 'bar'],
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('ModuleContents');
    if (r.info.kind !== 'ModuleContents') throw new Error('wrong info kind');
    expect(r.info.names).toEqual(['foo', 'bar']);
  });
  it('parses SearchAbout', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: { kind: 'SearchAbout', results: [], search: 'Nat -> Nat' },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('SearchAbout');
    if (r.info.kind !== 'SearchAbout') throw new Error('wrong info kind');
    expect(r.info.search).toBe('Nat -> Nat');
  });
  it('parses WhyInScope', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: { kind: 'WhyInScope', thing: 'Nat', filepath: '/N.agda', message: 'opened' },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('WhyInScope');
    if (r.info.kind !== 'WhyInScope') throw new Error('wrong info kind');
    expect(r.info.thing).toBe('Nat');
    expect(r.info.message).toBe('opened');
  });
  it('parses IntroNotFound (fallback for unknown DisplayInfo kinds)', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: { kind: 'DisplayInfo', info: { kind: 'BadInfoKind' } },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('IntroNotFound');
  });
  it('parses IntroConstructorUnknown', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: { kind: 'IntroConstructorUnknown', constructors: ['zero', 'suc'] },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('IntroConstructorUnknown');
    if (r.info.kind !== 'IntroConstructorUnknown') throw new Error('wrong info kind');
    expect(r.info.constructors).toEqual(['zero', 'suc']);
  });
});

// ---- DisplayInfo / GoalSpecific — remaining GoalInfo variants ----

describe('DisplayInfo / GoalSpecific — GoalInfo variants', () => {
  it('parses HelperFunction', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'GoalSpecific',
          interactionPoint: { id: 0, range: [] },
          goalInfo: { kind: 'HelperFunction', signature: '(n : Nat) → Nat' },
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('GoalSpecific');
    if (r.info.kind !== 'GoalSpecific') throw new Error('wrong info kind');
    expect(r.info.goalInfo.kind).toBe('HelperFunction');
    if (r.info.goalInfo.kind !== 'HelperFunction') throw new Error('wrong goal info kind');
    expect(r.info.goalInfo.signature).toBe('(n : Nat) → Nat');
  });

  it('parses NormalForm inside GoalSpecific', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'GoalSpecific',
          interactionPoint: { id: 0, range: [] },
          goalInfo: { kind: 'NormalForm', computeMode: 'DefaultCompute', expr: 'zero' },
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.goalInfo.kind).toBe('NormalForm');
    if (r.info.goalInfo.kind !== 'NormalForm') throw new Error('wrong goal info kind');
    expect(r.info.goalInfo.expr).toBe('zero');
    expect(r.info.goalInfo.computeMode).toBe('DefaultCompute');
  });

  it('parses CurrentGoal', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'GoalSpecific',
          interactionPoint: { id: 0, range: [] },
          goalInfo: { kind: 'CurrentGoal', rewrite: 'AsIs', type: 'Nat' },
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.goalInfo.kind).toBe('CurrentGoal');
    if (r.info.goalInfo.kind !== 'CurrentGoal') throw new Error('wrong goal info kind');
    expect(r.info.goalInfo.type).toBe('Nat');
    expect(r.info.goalInfo.rewrite).toBe('AsIs');
  });

  it('parses InferredType inside GoalSpecific', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'GoalSpecific',
          interactionPoint: { id: 0, range: [] },
          goalInfo: { kind: 'InferredType', expr: 'Nat' },
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.goalInfo.kind).toBe('InferredType');
    if (r.info.goalInfo.kind !== 'InferredType') throw new Error('wrong goal info kind');
    expect(r.info.goalInfo.expr).toBe('Nat');
  });
});

// ---- DisplayInfo / GoalSpecific — GoalTypeAux remaining variants ----

describe('DisplayInfo / GoalSpecific — GoalTypeAux variants', () => {
  it('parses GoalType with GoalAndHave typeAux', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'GoalSpecific',
          interactionPoint: { id: 0, range: [] },
          goalInfo: {
            kind: 'GoalType',
            rewrite: 'AsIs',
            typeAux: { kind: 'GoalAndHave', expr: 'zero' },
            type: 'Nat',
            entries: [],
            boundary: [],
            outputForms: [],
          },
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.goalInfo.kind).toBe('GoalType');
    if (r.info.goalInfo.kind !== 'GoalType') throw new Error('wrong goal info kind');
    expect(r.info.goalInfo.typeAux.kind).toBe('GoalAndHave');
    if (r.info.goalInfo.typeAux.kind !== 'GoalAndHave') throw new Error('wrong typeAux kind');
    expect(r.info.goalInfo.typeAux.expr).toBe('zero');
  });

  it('parses GoalType with GoalAndElaboration typeAux', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'GoalSpecific',
          interactionPoint: { id: 0, range: [] },
          goalInfo: {
            kind: 'GoalType',
            rewrite: 'Normalised',
            typeAux: { kind: 'GoalAndElaboration', term: 'λ x → x' },
            type: 'Nat → Nat',
            entries: [],
            boundary: [],
            outputForms: [],
          },
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.goalInfo.typeAux.kind).toBe('GoalAndElaboration');
    if (r.info.goalInfo.typeAux.kind !== 'GoalAndElaboration')
      throw new Error('wrong typeAux kind');
    expect(r.info.goalInfo.typeAux.term).toBe('λ x → x');
  });
});

// ---- OutputConstraint representative variants (via AllGoalsWarnings) ----

describe('OutputConstraint representative variants', () => {
  it('parses JustType constraint', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'AllGoalsWarnings',
          visibleGoals: [],
          invisibleGoals: [
            {
              kind: 'JustType',
              constraintObj: { name: '.m', range: [] },
            },
          ],
          warnings: [],
          errors: [],
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    expect(r.info.kind).toBe('AllGoalsWarnings');
    if (r.info.kind !== 'AllGoalsWarnings') throw new Error('wrong info kind');
    const g = r.info.invisibleGoals[0];
    expect(g.kind).toBe('JustType');
  });

  it('parses Assign constraint', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'AllGoalsWarnings',
          visibleGoals: [
            {
              kind: 'Assign',
              constraintObj: { id: 0, range: [] },
              value: 'zero',
            },
          ],
          invisibleGoals: [],
          warnings: [],
          errors: [],
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    const g = r.info.visibleGoals[0];
    expect(g.kind).toBe('Assign');
    if (g.kind !== 'Assign') throw new Error('wrong constraint kind');
    expect(g.value).toBe('zero');
  });

  it('parses CmpInType constraint', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'AllGoalsWarnings',
          visibleGoals: [
            {
              kind: 'CmpInType',
              comparison: 'Cmp',
              type: 'Nat',
              constraintObjs: [
                { id: 0, range: [] },
                { id: 1, range: [] },
              ],
            },
          ],
          invisibleGoals: [],
          warnings: [],
          errors: [],
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    const g = r.info.visibleGoals[0];
    expect(g.kind).toBe('CmpInType');
    if (g.kind !== 'CmpInType') throw new Error('wrong constraint kind');
    expect(g.comparison).toBe('Cmp');
    expect(g.type).toBe('Nat');
    expect(g.constraintObjs).toHaveLength(2);
  });

  it('parses IsEmptyType constraint', () => {
    const wire = {
      tag: 'ResponseJSONRaw',
      contents: {
        kind: 'DisplayInfo',
        info: {
          kind: 'AllGoalsWarnings',
          visibleGoals: [
            {
              kind: 'IsEmptyType',
              type: '⊥',
            },
          ],
          invisibleGoals: [],
          warnings: [],
          errors: [],
        },
      },
    };
    const r = parseAgdaResponse(wire);
    expect(r.kind).toBe('DisplayInfo');
    if (r.kind !== 'DisplayInfo') throw new Error('wrong kind');
    const g = r.info.visibleGoals[0];
    expect(g.kind).toBe('IsEmptyType');
    if (g.kind !== 'IsEmptyType') throw new Error('wrong constraint kind');
    expect(g.type).toBe('⊥');
  });
});
