/**
 * Command layer — orchestration only: transport + timing policy.
 *
 * Every command declares, in one responseDispatcher table, everything it
 * consumes from a response stream. Two timing policies:
 *  - session state (busy/runningInfo/error) dispatches in real time as responses
 *    stream in,
 *  - goal state waits until enough information has arrived — the goal
 *    payload (points, types) and the failure flag accumulate in local
 *    variables and are committed in one dispatch at the end; the raw
 *    stream is never buffered.
 *
 * ExecuteContext is the assembled seam: backend + view, plus the shared
 * executeCommand skeleton (sync vfs → run responses → session transactions)
 * and the convenience accessors commands build on. The commands differ only
 * in their handler tables and their final commit. These are the only pieces
 * of the agda layer that touch I/O.
 */

import type { EditorState, TransactionSpec } from '@codemirror/state';
import type {
  AgdaResponse,
  DisplayInfo,
  GiveResult,
  InteractionPoint,
  IOTCMCommand,
} from '@playground/language-backend-agda';
import {
  CommandBuilder,
  collectVisibleGoalTypes,
  formatAllGoals,
  HIGHLIGHTING_NONE,
} from '@playground/language-backend-agda';
import {
  expandGoalsTransaction,
  getGoals,
  giveReplacementTransaction,
  goalById,
  syncGoals,
} from '../model/goal-model';
import {
  appendEventTransaction,
  type EventLevel,
  formatElapse,
} from '../model/observability-model';
import {
  checkedTransaction,
  clearRunningInfoTransaction,
  commandEndTransaction,
  commandStartTransaction,
  diagnosticsTransaction,
  errorTransaction,
  filePathFacet,
  getSession,
  runningInfoTransaction,
} from '../model/session-model';
import { span } from './coords';

// ---------------------------------------------------------------------------
// Response dispatcher — shape-keyed callback table
// ---------------------------------------------------------------------------

/** Top-level handlers, keyed by response kind; each gets the narrowed response. */
type TopLevelHandlers = {
  [K in Exclude<AgdaResponse['kind'], 'DisplayInfo'>]?: (
    resp: Extract<AgdaResponse, { kind: K }>,
  ) => void;
};

/**
 * DisplayInfo handlers, keyed by info.kind; each gets the narrowed `info`
 * payload directly (the useful part of the two-level structure).
 */
type DisplayInfoHandlers = {
  [K in DisplayInfo['kind']]?: (info: Extract<DisplayInfo, { kind: K }>) => void;
};

/**
 * Callback table for {@link responseDispatcher}: one optional callback per
 * response shape the caller cares about; everything else is ignored.
 * `DisplayInfo` is the one nested union, so its handlers form a second-level
 * table keyed by info.kind.
 */
export type ResponseHandlers = TopLevelHandlers & { DisplayInfo?: DisplayInfoHandlers };

/**
 * Compile a {@link ResponseHandlers} table into a single dispatch function.
 * When a response matches a table entry, the destructured payload is passed
 * to that callback; unmatched responses are dropped silently — a command's
 * table is the single declaration of everything it consumes from a stream.
 *
 * The two casts are sound by construction: the table lookup and the response
 * share the same discriminant, so the handler always receives the variant it
 * was declared for.
 */
export function responseDispatcher(handlers: ResponseHandlers): (resp: AgdaResponse) => void {
  return resp => {
    if (resp.kind === 'DisplayInfo') {
      const byInfoKind = handlers.DisplayInfo;
      const handler = byInfoKind?.[resp.info.kind] as ((info: DisplayInfo) => void) | undefined;
      handler?.(resp.info);
      return;
    }
    const handler = handlers[resp.kind] as ((resp: AgdaResponse) => void) | undefined;
    handler?.(resp);
  };
}

/**
 * Structural interface for an EditorView-like target. Node tests fake this;
 * the real app passes its EditorView. Multiple specs dispatch as one
 * transaction — one UI update; later specs' positions are in the
 * coordinates after the earlier specs.
 */
export interface EditorViewLike {
  state: EditorState;
  dispatch(...specs: TransactionSpec[]): void;
}

/**
 * The slice of {@link Backend} the command layer forwards to, declared as
 * an interface so tests can inject a fake; the real backend is structurally
 * compatible.
 */
export type BackendLike = {
  /** Write the document to the virtual fs. */
  syncToVfs(path: string, text: string): Promise<void>;
  /** Stream one command's responses as they arrive (ends at the end marker). */
  stream(cmd: IOTCMCommand): AsyncGenerator<AgdaResponse>;
};

/**
 * Assembled command seam: backend + view, built once and passed to the
 * commands. All I/O of the agda layer flows through here.
 */
export class ExecuteContext {
  private readonly backend: BackendLike;
  private readonly view: EditorViewLike;

  constructor(backend: BackendLike, view: EditorViewLike) {
    this.backend = backend;
    this.view = view;
  }

  /** The workspace file this session edits (filePathFacet). */
  get filePath(): string {
    return this.view.state.facet(filePathFacet);
  }

  /** The view's current document text. */
  get docText(): string {
    return this.view.state.doc.toString();
  }

  /** The view's state, for the goal/session model helpers. */
  get state(): EditorState {
    return this.view.state;
  }

  /** A command builder addressed at the current file. */
  get builder(): CommandBuilder {
    return new CommandBuilder(this.filePath, { highlightingLevel: HIGHLIGHTING_NONE });
  }

  /** Dispatch transactions to the view; multiple specs combine into one. */
  dispatch(...specs: TransactionSpec[]): void {
    this.view.dispatch(...specs);
  }

  /**
   * Append a structured event to the observability log, scoped by the
   * command's kind: `Cmd_load::done`, `Cmd_give::error`, … — the command
   * names the scope, `kind` the step within it.
   */
  logCommandEvent(command: IOTCMCommand, level: EventLevel, kind: string, payload?: unknown): void {
    this.dispatch(appendEventTransaction(level, `${command.kind}::${kind}`, payload));
  }

  /**
   * Write the view's document to the virtual fs — the one vfs-write path,
   * shared by every explicit save and every command's pre-flight sync.
   * Times the write and narrates it as `fs::sync`: info + elapse on
   * success, error + message on failure. Never throws; returns whether
   * the write landed.
   */
  async syncToVfs(): Promise<boolean> {
    const startTs = performance.now();
    try {
      await this.backend.syncToVfs(this.filePath, this.docText);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.dispatch(appendEventTransaction('error', 'fs::sync', { error }));
      return false;
    }
    const elapse = formatElapse(performance.now() - startTs);
    this.dispatch(appendEventTransaction('info', 'fs::sync', { elapse }));
    return true;
  }

  /**
   * Shared skeleton of every command: open the session (busy on, error and
   * runningInfo cleared), sync the view's document to the virtual fs,
   * stream the command's responses, then close the session (busy off). The
   * command's failure, if any, lands in the session (errorTransaction) and
   * is read back via getSession(state).error after the call.
   *
   * The response stream runs through two handler tables, both of which see
   * every response: an internal common table (DisplayInfo.Error shows the
   * command's failure in the session and logs it; AllGoalsWarnings replaces
   * the module diagnostics) and the caller's own table (see
   * ResponseHandlers) covering what this command alone consumes. The 'End'
   * sentinel — the ALS command-finish marker that ends every stream —
   * reaches the caller's table too, so a command that must act after its
   * responses declares an End handler instead of hooking around the call.
   *
   * The runner narrates the command into the observability log, scoped by
   * the command's kind: `<Cmd>::cmdEnd` (info, stream elapse); the sync
   * narrates itself as the shared `fs::sync` event (the same write an
   * explicit save performs), and a failed sync skips the stream (a stale
   * vfs must not run the command). Wire frames themselves
   * are tapped at the backend layer, not re-logged here.
   */
  async executeCommand(cmd: IOTCMCommand, handlers?: ResponseHandlers): Promise<void> {
    // Every command shares two carriers. DisplayInfo.Error is the command's
    // failure — it lands in the session and in the observability log here,
    // so commands never log their own failure events. AllGoalsWarnings
    // carries the module's diagnostics — agda replays its accumulated
    // warnings/non-fatal errors inside every goals snapshot (every command
    // that displays goals ends by interpreting Cmd_metas, see
    // `Agda.Interaction.InteractionTop`), so every snapshot replaces the
    // diagnostics here, whatever command it rode in on.
    const commonHandlers: ResponseHandlers = {
      DisplayInfo: {
        Error: ({ error: err }) => {
          this.dispatch(errorTransaction(err.message));
          this.logCommandEvent(cmd, 'error', 'error', { error: err.message });
        },
        AllGoalsWarnings: info => {
          this.dispatch(
            diagnosticsTransaction({
              warnings: info.warnings.map(w => w.message),
              errors: info.errors.map(e => e.message),
            }),
          );
        },
      },
    };
    const dispatchCommon = responseDispatcher(commonHandlers);
    const dispatchUser = responseDispatcher(handlers ?? {});

    this.dispatch(commandStartTransaction());

    const synced = await this.syncToVfs();
    if (!synced) {
      // Close the session (busy off); the document was never checked.
      this.dispatch(commandEndTransaction());
      return;
    }

    const cmdStartTs = performance.now();
    for await (const resp of this.backend.stream(cmd)) {
      dispatchCommon(resp);
      dispatchUser(resp);
    }
    const cmdEndTs = performance.now();
    this.logCommandEvent(cmd, 'info', 'cmdEnd', { elapse: formatElapse(cmdEndTs - cmdStartTs) });

    this.dispatch(commandEndTransaction());
  }
}

/**
 * Type-check the file and rebuild the goal list, streaming responses to the
 * view: busy/runningInfo/error dispatch in real time; points and types
 * accumulate locally and commit once, when the End sentinel closes the
 * stream. Check failures that agda recovers from (termination, coverage, …)
 * do not keep the goal list: those goals are real — agda's error recovery
 * keeps the interaction points — so they commit alongside the module
 * diagnostics that carry the failure. Only a command exception
 * (DisplayInfo.Error, e.g. a parse error) keeps the old goal list.
 */
export async function executeLoad(ctx: ExecuteContext): Promise<void> {
  // Load's own table accumulates the goal payload for the single commit —
  // the interaction points and the whole AllGoalsWarnings snapshot (types
  // come out of it at commit time); the session-shaped responses dispatch
  // in real time. Failures reach the session through the skeleton: a
  // command exception via the common error table, a recovered check
  // failure via the diagnostics the common table extracts from the
  // snapshot (agda ≥ 2.8 reports load-time check failures in the
  // snapshot's errors array, never as DisplayInfo.Error).
  let points: InteractionPoint[] | undefined;
  let allGoals: Extract<DisplayInfo, { kind: 'AllGoalsWarnings' }> | undefined;
  const cmd = ctx.builder.load();

  await ctx.executeCommand(cmd, {
    ClearRunningInfo: () => ctx.dispatch(clearRunningInfoTransaction()),
    RunningInfo: ({ message }) => ctx.dispatch(runningInfoTransaction(message)),
    // The load stream's Status is agda's authoritative no-error verdict —
    // unsolved goals do not clear it ("All Done" is composed downstream as
    // checked && no goals). Only load consumes Status: after a give or any
    // local edit agda's verdict is stale until the next load re-confirms.
    Status: ({ status }) => ctx.dispatch(checkedTransaction(status.checked)),
    InteractionPoints: ({ interactionPoints }) => {
      points = points ?? [];
      points.push(...interactionPoints);
    },
    DisplayInfo: {
      AllGoalsWarnings: info => {
        allGoals = info;
        // Load is the check command, so its snapshot's errors are its own
        // failure: narrate them to the observability log (the common table
        // already put them in the session's diagnostics). A failed check
        // must not narrate the success lines over them — an empty-but-
        // erroneous snapshot stays silent; the panel shows the errors.
        if (info.errors.length > 0) {
          const message = info.errors.map(e => e.message).join('\n');
          ctx.logCommandEvent(cmd, 'error', 'error', { error: message });
          return;
        }
        for (const line of formatAllGoals(info)) ctx.dispatch(runningInfoTransaction(line));
      },
    },
    // The End sentinel is the last response of every stream, so it carries
    // the final commit. Load rebuilds the goal list from scratch (empty
    // `existing`) — ids may have been renumbered and entries the user
    // deleted must not survive — and expands fresh top-level `?` goals into
    // holes in the same transaction. Only a command exception (session
    // error) skips the commit: a recovered check failure still commits —
    // its goals are real, and the diagnostics carry the failure.
    End: () => {
      if (getSession(ctx.state).error !== undefined) return;
      const typesById = allGoals && collectVisibleGoalTypes(allGoals.visibleGoals);
      ctx.dispatch(expandGoalsTransaction(ctx.state, syncGoals([], points, typesById)));
    },
  });
}

/**
 * Fill a goal with an expression, applying the result to the view. The goal
 * is located by id (it may have been renumbered by a load); the whole hole
 * span is sent as the range so that agda reports fresh interaction points in
 * document coordinates.
 *
 * Streams responses through the same dispatcher-table idiom as load — one
 * table accumulating everything give consumes, committed once when the End
 * sentinel closes the stream — as a single two-spec dispatch (one UI
 * update): the replacement first, then the goal-list sync. The sync spec is
 * built against the pure post-replacement state, since a fresh goal's
 * response position only exists in the *new* document.
 *
 * Failures need no cleanup: the document was never changed. An agda error
 * lands in the session and the observability log via the skeleton's common
 * handler; a missing GiveAction is a silent no-op. Only an unknown goal id
 * throws (local check, before any I/O).
 */
export async function executeGive(
  ctx: ExecuteContext,
  goalId: number,
  payload: string,
): Promise<void> {
  const goal = goalById(ctx.state, goalId);
  if (!goal) {
    // No goal, so no command could run; the event still narrates the
    // intended give (an empty range is harmless — nothing is sent).
    ctx.logCommandEvent(ctx.builder.give(goalId, payload), 'error', 'error', {
      goalId,
      error: `goal ${goalId} not found`,
    });
    throw new Error(`goal ${goalId} not found`);
  }

  let giveResult: GiveResult | undefined;
  let points: InteractionPoint[] | undefined;
  let allGoals: Extract<DisplayInfo, { kind: 'AllGoalsWarnings' }> | undefined;
  const cmd = ctx.builder.give(goalId, payload, {
    range: span(ctx.state.doc, goal.from, goal.to),
  });

  await ctx.executeCommand(cmd, {
    GiveAction: ({ giveResult: result }) => {
      giveResult ??= result;
    },
    InteractionPoints: ({ interactionPoints }) => {
      points = points ?? [];
      points.push(...interactionPoints);
    },
    DisplayInfo: {
      AllGoalsWarnings: info => {
        allGoals = info;
      },
    },
    // The End sentinel carries the final commit, like load. A failure (the
    // skeleton put it in the session) or a missing GiveAction leaves the
    // document untouched — nothing to clean up.
    End: () => {
      if (getSession(ctx.state).error !== undefined) return;
      if (!giveResult) return;
      // One dispatch, two specs: the replacement, then the sync (marked
      // `sequential`, so its positions — in post-replacement coordinates,
      // since a fresh goal's response position only exists in the *new*
      // document — compose into the same transaction; one UI update).
      const replacement = giveReplacementTransaction(ctx.state, goal, payload, giveResult);
      const withText = ctx.state.update(replacement).state;
      const typesById = allGoals && collectVisibleGoalTypes(allGoals.visibleGoals);
      ctx.dispatch(
        replacement,
        expandGoalsTransaction(withText, syncGoals(getGoals(withText), points, typesById)),
      );
    },
  });
}
