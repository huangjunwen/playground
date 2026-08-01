/**
 * Parse Agda native JSONTop responses from the ALS --raw wire format.
 *
 * The LSP `agda` channel delivers two outer shapes:
 *   { tag: 'ResponseJSONRaw', contents: <kind-object> } – real responses, inner decoded by kind
 *   { tag: 'ResponseEnd' }                                – ALS-injected end sentinel
 * Malformed input yields { kind: 'Unknown' }.
 */

import type {
  AgdaResponse,
  ConstraintObj,
  DisplayInfo,
  GiveResult,
  GoalInfo,
  GoalTypeAux,
  HighlightingAtom,
  HighlightingInfoDirect,
  InteractionPoint,
  Interval,
  OutputConstraint,
  Position,
  Range,
  ResponseContextEntry,
  TCWarning,
} from './responses';

// ---- Guards ----

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isNum(v: unknown): v is number {
  return typeof v === 'number';
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

// ---- Position / Interval / Range ----

function parsePosition(v: unknown): Position | null {
  if (!isObj(v)) return null;
  const { pos, line, col } = v;
  if (isNum(pos) && isNum(line) && isNum(col)) {
    return { pos, line, col };
  }
  return null;
}

function parseInterval(v: unknown): Interval | null {
  if (!isObj(v)) return null;
  const start = parsePosition(v.start);
  const end = parsePosition(v.end);
  if (start && end) return { start, end };
  return null;
}

function parseRange(v: unknown): Range {
  if (!isArr(v)) return [];
  return v.map(parseInterval).filter((i): i is Interval => i !== null);
}

// ---- Interaction objects ----

function parseInteractionPoint(v: unknown): InteractionPoint | null {
  if (!isObj(v) || !isNum(v.id)) return null;
  return { id: v.id, range: parseRange(v.range) };
}

function parseConstraintObj(v: unknown): ConstraintObj | null {
  const ip = parseInteractionPoint(v);
  if (ip) return ip;
  if (!isObj(v) || !isStr(v.name)) return null;
  return { name: v.name, range: parseRange(v.range) };
}

// ---- GiveResult (key-distinguished, no kind) ----

function parseGiveResult(v: unknown): GiveResult | null {
  if (!isObj(v)) return null;
  if (isStr(v.str)) return { str: v.str };
  if (v.paren === true) return { paren: true };
  if (v.paren === false) return { paren: false };
  return null;
}

// ---- Highlighting ----

function parseHighlightingAtom(v: unknown): HighlightingAtom | null {
  if (!isObj(v)) return null;
  const { range, atoms, tokenBased, note, definitionSite } = v;
  if (!isArr(range) || range.length !== 2 || !isNum(range[0]) || !isNum(range[1])) return null;
  if (!isArr(atoms) || !atoms.every(isStr)) return null;
  if (!isStr(tokenBased) || !isStr(note)) return null;
  let ds: HighlightingAtom['definitionSite'] = null;
  if (isObj(definitionSite)) {
    const { filepath, position } = definitionSite;
    if (isStr(filepath) && isNum(position)) {
      ds = { filepath, position };
    }
  }
  return {
    range: [range[0], range[1]] as [number, number],
    atoms: atoms as string[],
    tokenBased: tokenBased as HighlightingAtom['tokenBased'],
    note,
    definitionSite: ds,
  };
}

// ---- TCWarning / TCErr ----

function parseTCWarning(v: unknown): TCWarning | null {
  if (!isObj(v) || !isStr(v.message)) return null;
  return { message: v.message };
}

// ---- ResponseContextEntry ----

function parseResponseContextEntry(v: unknown): ResponseContextEntry | null {
  if (!isObj(v)) return null;
  const { originalName, reifiedName, binding, inScope } = v;
  if (isStr(originalName) && isStr(reifiedName) && isStr(binding) && isBool(inScope)) {
    return { originalName, reifiedName, binding, inScope };
  }
  return null;
}

// ---- GoalTypeAux / GoalInfo ----

function parseGoalTypeAux(v: unknown): GoalTypeAux | null {
  if (!isObj(v) || !isStr(v.kind)) return null;
  switch (v.kind) {
    case 'GoalOnly':
      return { kind: 'GoalOnly' };
    case 'GoalAndHave':
      if (isStr(v.expr)) return { kind: 'GoalAndHave', expr: v.expr };
      return null;
    case 'GoalAndElaboration':
      if (isStr(v.term)) return { kind: 'GoalAndElaboration', term: v.term };
      return null;
  }
  return null;
}

function parseGoalInfo(v: unknown): GoalInfo | null {
  if (!isObj(v) || !isStr(v.kind)) return null;
  switch (v.kind) {
    case 'HelperFunction':
      if (isStr(v.signature)) return { kind: 'HelperFunction', signature: v.signature };
      return null;
    case 'NormalForm':
      if (isStr(v.computeMode) && isStr(v.expr))
        return { kind: 'NormalForm', computeMode: v.computeMode, expr: v.expr };
      return null;
    case 'GoalType': {
      if (!isStr(v.rewrite) || !isStr(v.type)) return null;
      const typeAux = parseGoalTypeAux(v.typeAux);
      if (!typeAux) return null;
      const entries: ResponseContextEntry[] = isArr(v.entries)
        ? v.entries
            .map(parseResponseContextEntry)
            .filter((e): e is ResponseContextEntry => e !== null)
        : [];
      const boundary: string[] = isArr(v.boundary) && v.boundary.every(isStr) ? v.boundary : [];
      const outputForms: string[] =
        isArr(v.outputForms) && v.outputForms.every(isStr) ? v.outputForms : [];
      return {
        kind: 'GoalType',
        rewrite: v.rewrite,
        typeAux,
        type: v.type,
        entries,
        boundary,
        outputForms,
      };
    }
    case 'CurrentGoal':
      if (isStr(v.rewrite) && isStr(v.type))
        return { kind: 'CurrentGoal', rewrite: v.rewrite, type: v.type };
      return null;
    case 'InferredType':
      if (isStr(v.expr)) return { kind: 'InferredType', expr: v.expr };
      return null;
  }
  return null;
}

// ---- OutputConstraint ----

const OUTPUT_CONSTRAINT_KINDS = new Set([
  'OfType',
  'JustType',
  'JustSort',
  'CmpInType',
  'CmpTypes',
  'CmpLevels',
  'CmpTeles',
  'CmpSorts',
  'CmpElim',
  'Assign',
  'TypedAssign',
  'PostponedCheckArgs',
  'IsEmptyType',
  'SizeLtSat',
  'FindInstanceOF',
  'ResolveInstanceOF',
  'PTSInstance',
  'PostponedCheckFunDef',
  'DataSort',
  'CheckLock',
  'UsableAtMod',
]);

function parseOutputConstraint(v: unknown): OutputConstraint | null {
  if (!isObj(v) || !isStr(v.kind) || !OUTPUT_CONSTRAINT_KINDS.has(v.kind)) return null;
  const result: Record<string, unknown> = { ...v };
  if (result.constraintObj !== undefined) {
    result.constraintObj = parseConstraintObj(result.constraintObj) ?? result.constraintObj;
  }
  if (isArr(result.constraintObjs)) {
    result.constraintObjs = result.constraintObjs.map(c => parseConstraintObj(c) ?? c);
  }
  return result as unknown as OutputConstraint;
}

// ---- DisplayInfo parsing ----

/**
 * Decode a native kind-discriminated DisplayInfo object.
 * Unknown kind → nullary fallback (no IntroNotFound means "nothing to show").
 */
function parseDisplayInfo(v: unknown): DisplayInfo {
  if (!isObj(v) || !isStr(v.kind)) return { kind: 'IntroNotFound' };
  switch (v.kind) {
    case 'AllGoalsWarnings': {
      const visibleGoals: OutputConstraint[] = isArr(v.visibleGoals)
        ? v.visibleGoals.map(parseOutputConstraint).filter((c): c is OutputConstraint => c !== null)
        : [];
      const invisibleGoals: OutputConstraint[] = isArr(v.invisibleGoals)
        ? v.invisibleGoals
            .map(parseOutputConstraint)
            .filter((c): c is OutputConstraint => c !== null)
        : [];
      const warnings: TCWarning[] = isArr(v.warnings)
        ? v.warnings.map(parseTCWarning).filter((w): w is TCWarning => w !== null)
        : [];
      const errors: TCWarning[] = isArr(v.errors)
        ? v.errors.map(parseTCWarning).filter((e): e is TCWarning => e !== null)
        : [];
      return { kind: 'AllGoalsWarnings', visibleGoals, invisibleGoals, warnings, errors };
    }
    case 'GoalSpecific': {
      const interactionPoint = parseInteractionPoint(v.interactionPoint);
      const goalInfo = parseGoalInfo(v.goalInfo);
      if (!interactionPoint || !goalInfo) break;
      return { kind: 'GoalSpecific', interactionPoint, goalInfo };
    }
    case 'Context': {
      const interactionPoint = parseInteractionPoint(v.interactionPoint);
      const context: ResponseContextEntry[] = isArr(v.context)
        ? v.context
            .map(parseResponseContextEntry)
            .filter((e): e is ResponseContextEntry => e !== null)
        : [];
      if (!interactionPoint) break;
      return { kind: 'Context', interactionPoint, context };
    }
    case 'Error': {
      const error =
        isObj(v.error) && isStr(v.error.message) ? { message: v.error.message } : { message: '' };
      const warnings: TCWarning[] = isArr(v.warnings)
        ? v.warnings.map(parseTCWarning).filter((w): w is TCWarning => w !== null)
        : [];
      return { kind: 'Error', error, warnings };
    }
    case 'CompilationOk': {
      const backend = isStr(v.backend) ? v.backend : '';
      const warnings: TCWarning[] = isArr(v.warnings)
        ? v.warnings.map(parseTCWarning).filter((w): w is TCWarning => w !== null)
        : [];
      const errors: TCWarning[] = isArr(v.errors)
        ? v.errors.map(parseTCWarning).filter((e): e is TCWarning => e !== null)
        : [];
      return { kind: 'CompilationOk', backend, warnings, errors };
    }
    case 'NormalForm': {
      const commandState = v.commandState;
      const computeMode = isStr(v.computeMode) ? v.computeMode : '';
      const time = v.time === null ? null : isStr(v.time) ? v.time : null;
      const expr = isStr(v.expr) ? v.expr : '';
      return { kind: 'NormalForm', commandState, computeMode, time, expr };
    }
    case 'InferredType': {
      const commandState = v.commandState;
      const time = v.time === null ? null : isStr(v.time) ? v.time : null;
      const expr = isStr(v.expr) ? v.expr : '';
      return { kind: 'InferredType', commandState, time, expr };
    }
    case 'Version': {
      return { kind: 'Version', version: isStr(v.version) ? v.version : '' };
    }
    case 'Auto': {
      return { kind: 'Auto', info: isStr(v.info) ? v.info : '' };
    }
    case 'Constraints': {
      return { kind: 'Constraints', constraints: v.constraints };
    }
    case 'Time': {
      return { kind: 'Time', time: isStr(v.time) ? v.time : '' };
    }
    case 'ModuleContents': {
      return {
        kind: 'ModuleContents',
        contents: v.contents,
        telescope: v.telescope,
        names: isArr(v.names) && v.names.every(isStr) ? v.names : [],
      };
    }
    case 'SearchAbout': {
      return {
        kind: 'SearchAbout',
        results: v.results,
        search: isStr(v.search) ? v.search : '',
      };
    }
    case 'WhyInScope': {
      return {
        kind: 'WhyInScope',
        thing: isStr(v.thing) ? v.thing : '',
        filepath: isStr(v.filepath) ? v.filepath : '',
        message: isStr(v.message) ? v.message : '',
      };
    }
    case 'IntroNotFound': {
      return { kind: 'IntroNotFound' };
    }
    case 'IntroConstructorUnknown': {
      return {
        kind: 'IntroConstructorUnknown',
        constructors: isArr(v.constructors) && v.constructors.every(isStr) ? v.constructors : [],
      };
    }
  }
  return { kind: 'IntroNotFound' };
}

// ---- Public API ----

/**
 * Parse a raw LSP `agda` channel params object into a typed AgdaResponse.
 * Unknown, malformed, or structurally invalid input yields { kind: 'Unknown' }.
 */
export function parseAgdaResponse(params: unknown): AgdaResponse {
  const unknown = (reason: string): AgdaResponse => {
    console.warn(`[parseAgdaResponse] Unknown (${reason}):`, params);
    return { kind: 'Unknown' };
  };

  if (!isObj(params) || !isStr(params.tag)) return unknown('non-object or missing tag');

  if (params.tag === 'ResponseEnd') return { kind: 'End' };

  if (params.tag !== 'ResponseJSONRaw') return unknown(`unexpected outer tag: ${params.tag}`);

  const inner = params.contents;
  if (!isObj(inner) || !isStr(inner.kind)) return unknown('inner missing or has no kind');

  switch (inner.kind) {
    case 'Status': {
      const status = inner.status;
      if (!isObj(status)) return unknown('Status missing status');
      return {
        kind: 'Status',
        status: {
          showImplicitArguments: isBool(status.showImplicitArguments)
            ? status.showImplicitArguments
            : false,
          showIrrelevantArguments: isBool(status.showIrrelevantArguments)
            ? status.showIrrelevantArguments
            : false,
          checked: isBool(status.checked) ? status.checked : false,
        },
      };
    }
    case 'InteractionPoints': {
      if (!isArr(inner.interactionPoints)) return unknown('InteractionPoints missing array');
      return {
        kind: 'InteractionPoints',
        interactionPoints: inner.interactionPoints
          .map(parseInteractionPoint)
          .filter((ip): ip is InteractionPoint => ip !== null),
      };
    }
    case 'DisplayInfo': {
      return { kind: 'DisplayInfo', info: parseDisplayInfo(inner.info) };
    }
    case 'HighlightingInfo': {
      const direct = inner.direct;
      if (direct === true) {
        const hli = inner.info;
        if (!isObj(hli)) return unknown('HighlightingInfo direct missing info');
        const info: HighlightingInfoDirect = {
          remove: isBool(hli.remove) ? hli.remove : false,
          payload: isArr(hli.payload)
            ? hli.payload
                .map(parseHighlightingAtom)
                .filter((a): a is HighlightingAtom => a !== null)
            : [],
        };
        return { kind: 'HighlightingInfo', direct: true, info };
      }
      if (direct === false) {
        return {
          kind: 'HighlightingInfo',
          direct: false,
          filepath: isStr(inner.filepath) ? inner.filepath : '',
        };
      }
      return unknown('HighlightingInfo invalid direct');
    }
    case 'ClearHighlighting': {
      return {
        kind: 'ClearHighlighting',
        tokenBased: isStr(inner.tokenBased)
          ? (inner.tokenBased as 'TokenBased' | 'NotOnlyTokenBased')
          : 'TokenBased',
      };
    }
    case 'ClearRunningInfo': {
      return { kind: 'ClearRunningInfo' };
    }
    case 'RunningInfo': {
      if (!isNum(inner.debugLevel) || !isStr(inner.message))
        return unknown('RunningInfo missing fields');
      return { kind: 'RunningInfo', debugLevel: inner.debugLevel, message: inner.message };
    }
    case 'JumpToError': {
      if (!isStr(inner.filepath) || !isNum(inner.position))
        return unknown('JumpToError missing fields');
      return { kind: 'JumpToError', filepath: inner.filepath, position: inner.position };
    }
    case 'GiveAction': {
      const ip = parseInteractionPoint(inner.interactionPoint);
      const gr = parseGiveResult(inner.giveResult);
      if (!ip || !gr) return unknown('GiveAction missing interactionPoint/giveResult');
      return { kind: 'GiveAction', interactionPoint: ip, giveResult: gr };
    }
    case 'MakeCase': {
      const ip = parseInteractionPoint(inner.interactionPoint);
      const variant = inner.variant;
      if (!ip || (variant !== 'Function' && variant !== 'ExtendedLambda'))
        return unknown('MakeCase invalid variant');
      const clauses: string[] =
        isArr(inner.clauses) && inner.clauses.every(isStr) ? inner.clauses : [];
      return { kind: 'MakeCase', interactionPoint: ip, variant, clauses };
    }
    case 'SolveAll': {
      if (!isArr(inner.solutions)) return unknown('SolveAll missing solutions');
      return {
        kind: 'SolveAll',
        solutions: inner.solutions.filter(isObj).map(s => ({
          interactionPoint: isNum(s.interactionPoint) ? s.interactionPoint : 0,
          expression: isStr(s.expression) ? s.expression : '',
        })),
      };
    }
    case 'Mimer': {
      const sol = inner.solution;
      if (sol === null) return { kind: 'Mimer', solution: null };
      if (isStr(sol)) return { kind: 'Mimer', solution: sol };
      return unknown('Mimer invalid solution');
    }
    case 'DoneExiting': {
      return { kind: 'DoneExiting' };
    }
    case 'DoneAborting': {
      return { kind: 'DoneAborting' };
    }
    default: {
      return unknown(`unknown inner kind: ${String(inner.kind)}`);
    }
  }
}
