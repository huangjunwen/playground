/**
 * Agda native JSON interaction response types.
 *
 * Mirrors agda's JSONTop `encodeTCM` output (the `--interaction-json` format),
 * defined in src/full/Agda/Interaction/JSONTop.hs.
 * Highlighting: src/full/Agda/Interaction/Highlighting/JSON.hs.
 * In ALS, delivered using `--raw` mode as `{tag:'ResponseJSONRaw', contents:{<native>}}`.
 */

import type { Range } from './range';

// ---- Interaction objects (JSONTop.hs, EncodeTCM InteractionId / NamedMeta) ----

export interface InteractionPoint {
  id: number;
  range: Range;
}
export interface NamedMeta {
  name: string;
  range: Range;
}
export type ConstraintObj = InteractionPoint | NamedMeta;

// ---- GiveResult (JSONTop.hs, key-distinguished, no kind) ----

export type GiveResult = { str: string } | { paren: true } | { paren: false };

// ---- Highlighting (Highlighting/JSON.hs) ----

export interface HighlightingAtom {
  range: [from: number, to: number]; // 1-based, half-open [from, to)
  atoms: string[];
  tokenBased: 'TokenBased' | 'NotOnlyTokenBased';
  note: string;
  definitionSite: { filepath: string; position: number } | null;
}
export interface HighlightingInfoDirect {
  remove: boolean;
  payload: HighlightingAtom[];
}

// ---- Warnings / errors (JSONTop.hs, EncodeTCM TCWarning / TCErr) ----

export interface TCWarning {
  message: string;
}
export interface TCErr {
  message: string;
}

// ---- OutputConstraint (JSONTop.hs, encodeOC) ----

export type OutputConstraint =
  | { kind: 'OfType'; constraintObj: ConstraintObj; type: string }
  | { kind: 'JustType' | 'JustSort'; constraintObj: ConstraintObj }
  | { kind: 'CmpInType'; comparison: string; type: string; constraintObjs: ConstraintObj[] }
  | {
      kind: 'CmpTypes' | 'CmpLevels' | 'CmpTeles' | 'CmpSorts';
      comparison: string;
      constraintObjs: ConstraintObj[];
    }
  | { kind: 'CmpElim'; polarities: string[]; type: string; constraintObjs: ConstraintObj[][] }
  | { kind: 'Assign'; constraintObj: ConstraintObj; value: string }
  | { kind: 'TypedAssign'; constraintObj: ConstraintObj; value: string; type: string }
  | {
      kind: 'PostponedCheckArgs';
      constraintObj: ConstraintObj;
      ofType: string;
      arguments: string[];
      type: string;
    }
  | { kind: 'IsEmptyType' | 'SizeLtSat'; type: string }
  | {
      kind: 'FindInstanceOF';
      constraintObj: ConstraintObj;
      candidates: { value: string; type: string }[];
      type: string;
    }
  | { kind: 'ResolveInstanceOF'; name: string }
  | { kind: 'PTSInstance'; constraintObjs: ConstraintObj[] }
  | { kind: 'PostponedCheckFunDef'; name: string; type: string; error: TCErr }
  | { kind: 'DataSort'; name: string; sort: string }
  | { kind: 'CheckLock'; head: string; lock: string }
  | { kind: 'UsableAtMod'; mod: string; term: string };

// ---- Context entry (JSONTop.hs, EncodeTCM ResponseContextEntry) ----

export interface ResponseContextEntry {
  originalName: string;
  reifiedName: string;
  binding: string;
  inScope: boolean;
}

// ---- GoalTypeAux / GoalInfo (JSONTop.hs, encodeGoalSpecific) ----

export type GoalTypeAux =
  | { kind: 'GoalOnly' }
  | { kind: 'GoalAndHave'; expr: string }
  | { kind: 'GoalAndElaboration'; term: string };

export type GoalInfo =
  | { kind: 'HelperFunction'; signature: string }
  | { kind: 'NormalForm'; computeMode: string; expr: string }
  | {
      kind: 'GoalType';
      rewrite: string;
      typeAux: GoalTypeAux;
      type: string;
      entries: ResponseContextEntry[];
      boundary: string[];
      outputForms: string[];
    }
  | { kind: 'CurrentGoal'; rewrite: string; type: string }
  | { kind: 'InferredType'; expr: string };

// ---- DisplayInfo (JSONTop.hs, encodeTCM DisplayInfo) ----

export type DisplayInfo =
  | {
      kind: 'AllGoalsWarnings';
      visibleGoals: OutputConstraint[];
      invisibleGoals: OutputConstraint[];
      warnings: TCWarning[];
      errors: TCWarning[];
    }
  | { kind: 'GoalSpecific'; interactionPoint: InteractionPoint; goalInfo: GoalInfo }
  | { kind: 'Context'; interactionPoint: InteractionPoint; context: ResponseContextEntry[] }
  | { kind: 'Error'; error: TCErr; warnings: TCWarning[] }
  | { kind: 'CompilationOk'; backend: string; warnings: TCWarning[]; errors: TCWarning[] }
  | {
      kind: 'NormalForm';
      commandState: unknown;
      computeMode: string;
      time: string | null;
      expr: string;
    }
  | { kind: 'InferredType'; commandState: unknown; time: string | null; expr: string }
  | { kind: 'Version'; version: string }
  | { kind: 'Auto'; info: string }
  | { kind: 'Constraints'; constraints: unknown }
  | { kind: 'Time'; time: string }
  | { kind: 'ModuleContents'; contents: unknown; telescope: unknown; names: string[] }
  | { kind: 'SearchAbout'; results: unknown; search: string }
  | { kind: 'WhyInScope'; thing: string; filepath: string; message: string }
  | { kind: 'IntroNotFound' }
  | { kind: 'IntroConstructorUnknown'; constructors: string[] };

// ---- Top-level Response (JSONTop.hs, encodeTCM Response) ----
//
// 'End' is NOT an agda response: it is ALS's command-finish sentinel
// (signalCommandFinish injects ResponseEnd out-of-band, identical in raw mode).

export type AgdaResponse =
  | {
      kind: 'Status';
      status: {
        showImplicitArguments: boolean;
        showIrrelevantArguments: boolean;
        checked: boolean;
      };
    }
  | { kind: 'InteractionPoints'; interactionPoints: InteractionPoint[] }
  | { kind: 'DisplayInfo'; info: DisplayInfo }
  | { kind: 'HighlightingInfo'; direct: true; info: HighlightingInfoDirect }
  | { kind: 'HighlightingInfo'; direct: false; filepath: string }
  | { kind: 'ClearHighlighting'; tokenBased: 'TokenBased' | 'NotOnlyTokenBased' }
  | { kind: 'ClearRunningInfo' }
  | { kind: 'RunningInfo'; debugLevel: number; message: string }
  | { kind: 'JumpToError'; filepath: string; position: number }
  | { kind: 'GiveAction'; interactionPoint: InteractionPoint; giveResult: GiveResult }
  | {
      kind: 'MakeCase';
      interactionPoint: InteractionPoint;
      variant: 'Function' | 'ExtendedLambda';
      clauses: string[];
    }
  | { kind: 'SolveAll'; solutions: { interactionPoint: number; expression: string }[] }
  | { kind: 'Mimer'; solution: string | null }
  | { kind: 'DoneExiting' }
  | { kind: 'DoneAborting' }
  | { kind: 'End' }
  | { kind: 'Unknown' };
