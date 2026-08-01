/**
 * IOTCM command builders for the Agda Language Server (ALS).
 *
 * Each builder produces a command string in IOTCM wire format:
 *   IOTCM <file-path> NonInteractive Direct (<cmd> [args...])
 *
 * The file path is JSON-quoted by the `iotcm` helper. Individual commands
 * may additionally quote arguments (e.g. Cmd_load takes a second path).
 *
 * Source: command constructors are the Interaction' ADT (Agda
 * Interaction/Base.hs); dispatch is interpret (Interaction/InteractionTop.hs).
 * Responses are agda native JSONTop format (kind-discriminated, see
 * src/full/Agda/Interaction/JSONTop.hs).
 */

import {
  COMPUTE_DEFAULT,
  FORCE_WITH,
  FORCE_WITHOUT,
  KEEP_FILE,
  NO_RANGE,
  REMOVE_FILE,
  REWRITE_AS_IS,
} from './const';

export interface IOTCMCommand {
  raw: string;
}

/** Wrap a command payload inside the IOTCM envelope. */
function iotcm(filePath: string, cmd: string): IOTCMCommand {
  const path = JSON.stringify(filePath);
  return { raw: `IOTCM ${path} NonInteractive Direct (${cmd})` };
}

/** Load a .agda file and type-check it. Sends AllGoalsWarnings + highlighting + Status. */
export function cmdLoad(filePath: string): IOTCMCommand {
  // Cmd_load requires a JSON-quoted path as argument (separate from the
  // IOTCM envelope path, which is also JSON-quoted by the iotcm helper).
  const path = JSON.stringify(filePath);
  return iotcm(filePath, `Cmd_load ${path} []`);
}

/** List all unsolved goals. Sends AllGoalsWarnings. */
export function cmdMetas(filePath: string): IOTCMCommand {
  return iotcm(filePath, `Cmd_metas ${REWRITE_AS_IS}`);
}

/** Fill a goal with an expression. Sends GiveAction + AllGoalsWarnings. */
export function cmdGive(
  filePath: string,
  goalId: number,
  content: string,
  opts?: { force?: boolean; range?: string },
): IOTCMCommand {
  const force = opts?.force ? FORCE_WITH : FORCE_WITHOUT;
  const range = opts?.range ?? NO_RANGE;
  return iotcm(filePath, `Cmd_give ${force} ${goalId} ${range} ${JSON.stringify(content)}`);
}

/** Case-split on a variable in a goal. Sends MakeCase (variant 'Function' or 'ExtendedLambda'). */
export function cmdCase(
  filePath: string,
  goalId: number,
  content: string,
  opts?: { range?: string },
): IOTCMCommand {
  const range = opts?.range ?? NO_RANGE;
  return iotcm(filePath, `Cmd_make_case ${goalId} ${range} ${JSON.stringify(content)}`);
}

/** Evaluate/normalise an expression in a goal's context. Sends GoalSpecific (NormalForm). */
export function cmdCompute(
  filePath: string,
  goalId?: number,
  expr?: string,
  opts?: { computeMode?: string; range?: string },
): IOTCMCommand {
  const mode = opts?.computeMode ?? COMPUTE_DEFAULT;
  const range = opts?.range ?? NO_RANGE;
  if (goalId !== undefined && expr !== undefined) {
    return iotcm(filePath, `Cmd_compute ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`);
  }
  return iotcm(filePath, `Cmd_compute ${mode}`);
}

/** Abort the currently running command. Intercepted by readCommands; sends no response of its own. */
export function cmdAbort(filePath: string): IOTCMCommand {
  return iotcm(filePath, 'Cmd_abort');
}

/** Mimer proof search on a single goal. On a hit sends GiveAction; otherwise Auto. */
export function cmdAutoOne(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_autoOne ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`);
}

/** Mimer proof search on all goals. Sends one GiveAction per solved goal. */
export function cmdAutoAll(filePath: string, opts?: { rewriteMode?: string }): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  return iotcm(filePath, `Cmd_autoAll ${mode}`);
}

/** Report the internal instantiation solutions of all goals. Sends SolveAll. */
export function cmdSolveAll(filePath: string, opts?: { rewriteMode?: string }): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  return iotcm(filePath, `Cmd_solveAll ${mode}`);
}

/** Report the internal instantiation solution of a single goal. Sends SolveAll (empty [] if uninstantiated). */
export function cmdSolveOne(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_solveOne ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`);
}

/** Show the current goal's type. Sends GoalSpecific (CurrentGoal). */
export function cmdGoalType(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_goal_type ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`);
}

/** Show the goal's type and context. Sends GoalSpecific (GoalType). */
export function cmdGoalTypeContext(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(
    filePath,
    `Cmd_goal_type_context ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`,
  );
}

/** Infer the type of an expression in a goal's context. Sends InferredType. */
export function cmdInfer(
  filePath: string,
  goalId: number,
  expr?: string,
  opts?: { rewriteMode?: string; range?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  return iotcm(filePath, `Cmd_infer ${mode} ${goalId} ${range} ${JSON.stringify(expr ?? '')}`);
}

/** Exit the ALS process. Sends DoneExiting. */
export function cmdExit(filePath: string): IOTCMCommand {
  return iotcm(filePath, 'Cmd_exit');
}

/**
 * Compile a module using the given backend. Sends CompilationOk on success.
 * Supported backends: 'LaTeX', 'QuickLaTeX', 'MAlonzo' (needs GHC, not available in WASM).
 */
export function cmdCompile(filePath: string, backend: string, args: string[] = []): IOTCMCommand {
  const path = JSON.stringify(filePath);
  const argsStr = args.length > 0 ? ` [${args.map(a => JSON.stringify(a)).join(', ')}]` : ' []';
  return iotcm(filePath, `Cmd_compile ${backend} ${path}${argsStr}`);
}

/** Infer the type of an expression at the top level (not inside a goal). Sends InferredType. */
export function cmdInferToplevel(
  filePath: string,
  expr: string,
  opts?: { rewriteMode?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  return iotcm(filePath, `Cmd_infer_toplevel ${mode} ${JSON.stringify(expr)}`);
}

/** Evaluate/normalise an expression at the top level (not inside a goal). Sends NormalForm. */
export function cmdComputeToplevel(
  filePath: string,
  expr: string,
  opts?: { computeMode?: string },
): IOTCMCommand {
  const mode = opts?.computeMode ?? COMPUTE_DEFAULT;
  return iotcm(filePath, `Cmd_compute_toplevel ${mode} ${JSON.stringify(expr)}`);
}

// ---- Module loading ----

/** Load a file and fail (__IMPOSSIBLE__) if there are any unsolved metas. Sends Status + End on success. */
export function cmdLoadNoMetas(filePath: string): IOTCMCommand {
  const path = JSON.stringify(filePath);
  return iotcm(filePath, `Cmd_load_no_metas ${path}`);
}

/** Load cached highlighting info for an already-visited module. Sends HighlightingInfo (or nothing). */
export function cmdLoadHighlightingInfo(filePath: string): IOTCMCommand {
  const path = JSON.stringify(filePath);
  return iotcm(filePath, `Cmd_load_highlighting_info ${path}`);
}

// ---- Toplevel queries ----

/** List all unsolved constraints. Sends Constraints. */
export function cmdConstraints(filePath: string): IOTCMCommand {
  return iotcm(filePath, 'Cmd_constraints');
}

/** List all top-level names in a module with their types. Sends ModuleContents; empty name browses all. */
export function cmdShowModuleContentsToplevel(
  filePath: string,
  name: string,
  opts?: { rewriteMode?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  return iotcm(filePath, `Cmd_show_module_contents_toplevel ${mode} ${JSON.stringify(name)}`);
}

/** Search top-level names whose type mentions the given identifiers. Sends SearchAbout. */
export function cmdSearchAboutToplevel(
  filePath: string,
  query: string,
  opts?: { rewriteMode?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  return iotcm(filePath, `Cmd_search_about_toplevel ${mode} ${JSON.stringify(query)}`);
}

/** Explain why a name is in scope at the top level. Sends WhyInScope. */
export function cmdWhyInScopeToplevel(filePath: string, name: string): IOTCMCommand {
  return iotcm(filePath, `Cmd_why_in_scope_toplevel ${JSON.stringify(name)}`);
}

/** Display the running Agda version. Sends Version. */
export function cmdShowVersion(filePath: string): IOTCMCommand {
  return iotcm(filePath, 'Cmd_show_version');
}

// ---- Goal inspection ----

/** Show the context (variable list) of the current goal. Sends Context. */
export function cmdContext(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_context ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`);
}

/** List module contents within a goal's scope. Sends ModuleContents; empty name browses all. */
export function cmdShowModuleContents(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(
    filePath,
    `Cmd_show_module_contents ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`,
  );
}

/** Explain why a name is in scope within a goal. Sends WhyInScope. */
export function cmdWhyInScope(
  filePath: string,
  goalId: number,
  opts?: { range?: string; expr?: string },
): IOTCMCommand {
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_why_in_scope ${goalId} ${range} ${JSON.stringify(expr)}`);
}

/** Show goal type + context and infer the type of an expression. Sends GoalSpecific (GoalType, typeAux GoalAndHave). */
export function cmdGoalTypeContextInfer(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(
    filePath,
    `Cmd_goal_type_context_infer ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`,
  );
}

/** Show goal type + context and check an expression against it. Sends GoalSpecific (GoalType, typeAux GoalAndElaboration). */
export function cmdGoalTypeContextCheck(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(
    filePath,
    `Cmd_goal_type_context_check ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`,
  );
}

// ---- Goal solving ----

/** Refine a goal with an expression (introduces helpers/lambdas). Sends GiveAction + DisplayInfo. */
export function cmdRefine(
  filePath: string,
  goalId: number,
  opts?: { range?: string; expr?: string },
): IOTCMCommand {
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_refine ${goalId} ${range} ${JSON.stringify(expr)}`);
}

/** Intro tactic: introduce a variable or constructor into a goal. Sends GiveAction. */
export function cmdIntro(
  filePath: string,
  goalId: number,
  opts?: { pmLambda?: boolean; range?: string; expr?: string },
): IOTCMCommand {
  const pmLambda = opts?.pmLambda ? 'True' : 'False';
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_intro ${pmLambda} ${goalId} ${range} ${JSON.stringify(expr)}`);
}

/** If the expression is non-empty, refine; otherwise intro. Sends GiveAction. */
export function cmdRefineOrIntro(
  filePath: string,
  goalId: number,
  opts?: { pmLambda?: boolean; range?: string; expr?: string },
): IOTCMCommand {
  const pmLambda = opts?.pmLambda ? 'True' : 'False';
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(
    filePath,
    `Cmd_refine_or_intro ${pmLambda} ${goalId} ${range} ${JSON.stringify(expr)}`,
  );
}

/** Elaborated give: fill a goal and return the elaborated term. Sends GiveAction + DisplayInfo. */
export function cmdElaborateGive(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_elaborate_give ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`);
}

/** Generate the type of a helper function that would solve the goal. Sends GoalSpecific (HelperFunction); a bare hole sends Error. */
export function cmdHelperFunction(
  filePath: string,
  goalId: number,
  opts?: { rewriteMode?: string; range?: string; expr?: string },
): IOTCMCommand {
  const mode = opts?.rewriteMode ?? REWRITE_AS_IS;
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_helper_function ${mode} ${goalId} ${range} ${JSON.stringify(expr)}`);
}

// ---- Highlighting ----

/** Compute pure token-based highlighting (no type-checking needed). Sends ClearHighlighting + HighlightingInfo. */
export function cmdTokenHighlighting(
  filePath: string,
  source: string,
  opts?: { remove?: boolean },
): IOTCMCommand {
  const remove = opts?.remove ? REMOVE_FILE : KEEP_FILE;
  const src = JSON.stringify(source);
  return iotcm(filePath, `Cmd_tokenHighlighting ${src} ${remove}`);
}

/** Compute highlighting for an expression just spliced into a goal. Sends HighlightingInfo (KeepHighlighting). */
export function cmdHighlight(
  filePath: string,
  goalId: number,
  opts?: { range?: string; expr?: string },
): IOTCMCommand {
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(filePath, `Cmd_highlight ${goalId} ${range} ${JSON.stringify(expr)}`);
}

// ---- Backend commands ----

/** Custom top-level command for a backend. Sends End (no-op) when no backend is registered. */
export function cmdBackendTop(filePath: string, backend: string, payload: string): IOTCMCommand {
  return iotcm(filePath, `Cmd_backend_top ${backend} ${JSON.stringify(payload)}`);
}

/** Custom hole-level command for a backend. Sends End (no-op) when no backend is registered. */
export function cmdBackendHole(
  filePath: string,
  goalId: number,
  backend: string,
  payload: string,
  opts?: { range?: string; expr?: string },
): IOTCMCommand {
  const range = opts?.range ?? NO_RANGE;
  const expr = opts?.expr ?? '';
  return iotcm(
    filePath,
    `Cmd_backend_hole ${goalId} ${range} ${JSON.stringify(expr)} ${backend} ${JSON.stringify(payload)}`,
  );
}

// ---- Display toggles ----

/** Set whether implicit arguments are displayed. Sends Status + End. */
export function cmdShowImplicitArgs(filePath: string, show: boolean): IOTCMCommand {
  return iotcm(filePath, `ShowImplicitArgs ${show ? 'True' : 'False'}`);
}

/** Toggle display of implicit arguments. Sends Status + End. */
export function cmdToggleImplicitArgs(filePath: string): IOTCMCommand {
  return iotcm(filePath, 'ToggleImplicitArgs');
}

/** Set whether irrelevant arguments are displayed. Sends Status + End. */
export function cmdShowIrrelevantArgs(filePath: string, show: boolean): IOTCMCommand {
  return iotcm(filePath, `ShowIrrelevantArgs ${show ? 'True' : 'False'}`);
}

/** Toggle display of irrelevant arguments. Sends Status + End. */
export function cmdToggleIrrelevantArgs(filePath: string): IOTCMCommand {
  return iotcm(filePath, 'ToggleIrrelevantArgs');
}
