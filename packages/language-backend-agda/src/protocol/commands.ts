/**
 * IOTCM command builders for the Agda Language Server (ALS).
 *
 * Each method produces a command string in IOTCM wire format:
 *   IOTCM <file-path> <highlighting-level> Direct (<cmd> [args...])
 *
 * Source: command constructors are the Interaction' ADT (Agda
 * Interaction/Base.hs); dispatch is interpret (Interaction/InteractionTop.hs).
 * Responses are agda native JSONTop format (kind-discriminated, see
 * src/full/Agda/Interaction/JSONTop.hs).
 */

import {
  COMPUTE_DEFAULT,
  type ComputeMode,
  FORCE_WITH,
  FORCE_WITHOUT,
  HIGHLIGHTING_NON_INTERACTIVE,
  type HighlightingLevel,
  KEEP_FILE,
  REMOVE_FILE,
  REWRITE_AS_IS,
  type RewriteMode,
} from './const';
import { type Range, serializeRange } from './range';

export interface IOTCMCommand {
  raw: string;
  /** Command name, verbatim: 'Cmd_load', 'Cmd_give', or a display toggle such as 'ShowImplicitArgs'. */
  kind: string;
}

/** Options shared across every command of a `CommandBuilder`. */
export interface CommandBuilderOptions {
  /** How much highlighting the server returns. Defaults to non-interactive. */
  highlightingLevel?: HighlightingLevel;
  /** Rewrite/normalisation mode for commands that take one. Defaults to AsIs. */
  rewriteMode?: RewriteMode;
}

/**
 * Builds IOTCM commands for a single module, binding the file path and the
 * cross-command defaults (highlighting level, rewrite mode).
 */
export class CommandBuilder {
  private readonly filePath: string;
  private readonly highlightingLevel: HighlightingLevel;
  private readonly rewriteMode: RewriteMode;

  constructor(filePath: string, options: CommandBuilderOptions = {}) {
    this.filePath = filePath;
    this.highlightingLevel = options.highlightingLevel ?? HIGHLIGHTING_NON_INTERACTIVE;
    this.rewriteMode = options.rewriteMode ?? REWRITE_AS_IS;
  }

  /**
   * Wrap a command inside the IOTCM envelope. `kind` is the command name,
   * verbatim ('Cmd_load', or a display toggle like 'ShowImplicitArgs');
   * `args` is the rest of the payload, already in wire format.
   */
  private iotcm(kind: string, args = ''): IOTCMCommand {
    const path = JSON.stringify(this.filePath);
    return {
      raw: `IOTCM ${path} ${this.highlightingLevel} Direct (${kind}${args ? ` ${args}` : ''})`,
      kind,
    };
  }

  /** Load a .agda file and type-check it. Sends AllGoalsWarnings + highlighting + Status. */
  load(): IOTCMCommand {
    // Cmd_load requires a JSON-quoted path as argument (separate from the
    // IOTCM envelope path, which is also JSON-quoted by the iotcm helper).
    const path = JSON.stringify(this.filePath);
    return this.iotcm('Cmd_load', `${path} []`);
  }

  /** List all unsolved goals. Sends AllGoalsWarnings. */
  metas(): IOTCMCommand {
    return this.iotcm('Cmd_metas', this.rewriteMode);
  }

  /** Fill a goal with an expression. Sends GiveAction + AllGoalsWarnings. */
  give(goalId: number, content: string, opts?: { force?: boolean; range?: Range }): IOTCMCommand {
    const force = opts?.force ? FORCE_WITH : FORCE_WITHOUT;
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm('Cmd_give', `${force} ${goalId} ${range} ${JSON.stringify(content)}`);
  }

  /** Case-split on a variable in a goal. Sends MakeCase (variant 'Function' or 'ExtendedLambda'). */
  case(goalId: number, content: string, opts?: { range?: Range }): IOTCMCommand {
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm('Cmd_make_case', `${goalId} ${range} ${JSON.stringify(content)}`);
  }

  /** Evaluate/normalise an expression in a goal's context. Sends GoalSpecific (NormalForm). */
  compute(
    goalId?: number,
    expr?: string,
    opts?: { computeMode?: ComputeMode; range?: Range },
  ): IOTCMCommand {
    const mode = opts?.computeMode ?? COMPUTE_DEFAULT;
    if (goalId !== undefined && expr !== undefined) {
      const range = serializeRange(opts?.range ?? []);
      return this.iotcm('Cmd_compute', `${mode} ${goalId} ${range} ${JSON.stringify(expr)}`);
    }
    return this.iotcm('Cmd_compute', mode);
  }

  /** Abort the currently running command. Intercepted by readCommands; sends no response of its own. */
  abort(): IOTCMCommand {
    return this.iotcm('Cmd_abort');
  }

  /** Mimer proof search on a single goal. On a hit sends GiveAction; otherwise Auto. */
  autoOne(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_autoOne',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** Mimer proof search on all goals. Sends one GiveAction per solved goal. */
  autoAll(): IOTCMCommand {
    return this.iotcm('Cmd_autoAll', this.rewriteMode);
  }

  /** Report the internal instantiation solutions of all goals. Sends SolveAll. */
  solveAll(): IOTCMCommand {
    return this.iotcm('Cmd_solveAll', this.rewriteMode);
  }

  /** Report the internal instantiation solution of a single goal. Sends SolveAll (empty [] if uninstantiated). */
  solveOne(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_solveOne',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** Show the current goal's type. Sends GoalSpecific (CurrentGoal). */
  goalType(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_goal_type',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** Show the goal's type and context. Sends GoalSpecific (GoalType). */
  goalTypeContext(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_goal_type_context',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** Infer the type of an expression in a goal's context. Sends InferredType. */
  infer(goalId: number, expr?: string, opts?: { range?: Range }): IOTCMCommand {
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_infer',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr ?? '')}`,
    );
  }

  /** Exit the ALS process. Sends DoneExiting. */
  exit(): IOTCMCommand {
    return this.iotcm('Cmd_exit');
  }

  /**
   * Compile a module using the given backend. Sends CompilationOk on success.
   * Supported backends: 'LaTeX', 'QuickLaTeX', 'MAlonzo' (needs GHC, not available in WASM).
   */
  compile(backend: string, args: string[] = []): IOTCMCommand {
    const path = JSON.stringify(this.filePath);
    const argsStr = args.length > 0 ? ` [${args.map(a => JSON.stringify(a)).join(', ')}]` : ' []';
    return this.iotcm('Cmd_compile', `${backend} ${path}${argsStr}`);
  }

  /** Infer the type of an expression at the top level (not inside a goal). Sends InferredType. */
  inferToplevel(expr: string): IOTCMCommand {
    return this.iotcm('Cmd_infer_toplevel', `${this.rewriteMode} ${JSON.stringify(expr)}`);
  }

  /** Evaluate/normalise an expression at the top level (not inside a goal). Sends NormalForm. */
  computeToplevel(expr: string, opts?: { computeMode?: ComputeMode }): IOTCMCommand {
    const mode = opts?.computeMode ?? COMPUTE_DEFAULT;
    return this.iotcm('Cmd_compute_toplevel', `${mode} ${JSON.stringify(expr)}`);
  }

  // ---- Module loading ----

  /** Load a file and fail (__IMPOSSIBLE__) if there are any unsolved metas. Sends Status + End on success. */
  loadNoMetas(): IOTCMCommand {
    const path = JSON.stringify(this.filePath);
    return this.iotcm('Cmd_load_no_metas', path);
  }

  /** Load cached highlighting info for an already-visited module. Sends HighlightingInfo (or nothing). */
  loadHighlightingInfo(): IOTCMCommand {
    const path = JSON.stringify(this.filePath);
    return this.iotcm('Cmd_load_highlighting_info', path);
  }

  // ---- Toplevel queries ----

  /** List all unsolved constraints. Sends Constraints. */
  constraints(): IOTCMCommand {
    return this.iotcm('Cmd_constraints');
  }

  /** List all top-level names in a module with their types. Sends ModuleContents; empty name browses all. */
  showModuleContentsToplevel(name: string): IOTCMCommand {
    return this.iotcm(
      'Cmd_show_module_contents_toplevel',
      `${this.rewriteMode} ${JSON.stringify(name)}`,
    );
  }

  /** Search top-level names whose type mentions the given identifiers. Sends SearchAbout. */
  searchAboutToplevel(query: string): IOTCMCommand {
    return this.iotcm('Cmd_search_about_toplevel', `${this.rewriteMode} ${JSON.stringify(query)}`);
  }

  /** Explain why a name is in scope at the top level. Sends WhyInScope. */
  whyInScopeToplevel(name: string): IOTCMCommand {
    return this.iotcm('Cmd_why_in_scope_toplevel', JSON.stringify(name));
  }

  /** Display the running Agda version. Sends Version. */
  showVersion(): IOTCMCommand {
    return this.iotcm('Cmd_show_version');
  }

  // ---- Goal inspection ----

  /** Show the context (variable list) of the current goal. Sends Context. */
  context(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_context',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** List module contents within a goal's scope. Sends ModuleContents; empty name browses all. */
  showModuleContents(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_show_module_contents',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** Explain why a name is in scope within a goal. Sends WhyInScope. */
  whyInScope(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm('Cmd_why_in_scope', `${goalId} ${range} ${JSON.stringify(expr)}`);
  }

  /** Show goal type + context and infer the type of an expression. Sends GoalSpecific (GoalType, typeAux GoalAndHave). */
  goalTypeContextInfer(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_goal_type_context_infer',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** Show goal type + context and check an expression against it. Sends GoalSpecific (GoalType, typeAux GoalAndElaboration). */
  goalTypeContextCheck(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_goal_type_context_check',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  // ---- Goal solving ----

  /** Refine a goal with an expression (introduces helpers/lambdas). Sends GiveAction + DisplayInfo. */
  refine(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm('Cmd_refine', `${goalId} ${range} ${JSON.stringify(expr)}`);
  }

  /** Intro tactic: introduce a variable or constructor into a goal. Sends GiveAction. */
  intro(goalId: number, opts?: { pmLambda?: boolean; expr?: string; range?: Range }): IOTCMCommand {
    const pmLambda = opts?.pmLambda ? 'True' : 'False';
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm('Cmd_intro', `${pmLambda} ${goalId} ${range} ${JSON.stringify(expr)}`);
  }

  /** If the expression is non-empty, refine; otherwise intro. Sends GiveAction. */
  refineOrIntro(
    goalId: number,
    opts?: { pmLambda?: boolean; expr?: string; range?: Range },
  ): IOTCMCommand {
    const pmLambda = opts?.pmLambda ? 'True' : 'False';
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_refine_or_intro',
      `${pmLambda} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** Elaborated give: fill a goal and return the elaborated term. Sends GiveAction + DisplayInfo. */
  elaborateGive(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_elaborate_give',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  /** Generate the type of a helper function that would solve the goal. Sends GoalSpecific (HelperFunction); a bare hole sends Error. */
  helperFunction(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_helper_function',
      `${this.rewriteMode} ${goalId} ${range} ${JSON.stringify(expr)}`,
    );
  }

  // ---- Highlighting ----

  /** Compute pure token-based highlighting (no type-checking needed). Sends ClearHighlighting + HighlightingInfo. */
  tokenHighlighting(source: string, opts?: { remove?: boolean }): IOTCMCommand {
    const remove = opts?.remove ? REMOVE_FILE : KEEP_FILE;
    const src = JSON.stringify(source);
    return this.iotcm('Cmd_tokenHighlighting', `${src} ${remove}`);
  }

  /** Compute highlighting for an expression just spliced into a goal. Sends HighlightingInfo (KeepHighlighting). */
  highlight(goalId: number, opts?: { expr?: string; range?: Range }): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm('Cmd_highlight', `${goalId} ${range} ${JSON.stringify(expr)}`);
  }

  // ---- Backend commands ----

  /** Custom top-level command for a backend. Sends End (no-op) when no backend is registered. */
  backendTop(backend: string, payload: string): IOTCMCommand {
    return this.iotcm('Cmd_backend_top', `${backend} ${JSON.stringify(payload)}`);
  }

  /** Custom hole-level command for a backend. Sends End (no-op) when no backend is registered. */
  backendHole(
    goalId: number,
    backend: string,
    payload: string,
    opts?: { expr?: string; range?: Range },
  ): IOTCMCommand {
    const expr = opts?.expr ?? '';
    const range = serializeRange(opts?.range ?? []);
    return this.iotcm(
      'Cmd_backend_hole',
      `${goalId} ${range} ${JSON.stringify(expr)} ${backend} ${JSON.stringify(payload)}`,
    );
  }

  // ---- Display toggles ----

  /** Set whether implicit arguments are displayed. Sends Status + End. */
  showImplicitArgs(show: boolean): IOTCMCommand {
    return this.iotcm('ShowImplicitArgs', show ? 'True' : 'False');
  }

  /** Toggle display of implicit arguments. Sends Status + End. */
  toggleImplicitArgs(): IOTCMCommand {
    return this.iotcm('ToggleImplicitArgs');
  }

  /** Set whether irrelevant arguments are displayed. Sends Status + End. */
  showIrrelevantArgs(show: boolean): IOTCMCommand {
    return this.iotcm('ShowIrrelevantArgs', show ? 'True' : 'False');
  }

  /** Toggle display of irrelevant arguments. Sends Status + End. */
  toggleIrrelevantArgs(): IOTCMCommand {
    return this.iotcm('ToggleIrrelevantArgs');
  }
}
