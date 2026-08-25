import './main.css';
import { indentWithTab } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { DEFAULT_ALS_WORKSPACE } from '@playground/language-backend-agda';
import { basicSetup } from 'codemirror';
import { Backend } from './backend/backend';
import { ExecuteContext } from './integration/commands';
import { lspFrameEvent, lspLogEvent } from './integration/lsp-events';
import { agda } from './language/agda';
import { goalModelField, HOLE_BOUNDARY } from './model/goal-model';
import { observabilityModelField } from './model/observability-model';
import {
  backendBootingTransaction,
  backendExitTransaction,
  backendOnlineTransaction,
  filePathFacet,
  sessionModelField,
} from './model/session-model';
import { appKeymap, wireGlobalKeys } from './ui/app-keymap';
import { Chrome } from './ui/chrome';
import { CommandPalette } from './ui/command-palette';
import { buildCommands } from './ui/commands';
import { EventsPanel } from './ui/events-panel';
import { goalDecorations, goalStyleTheme } from './ui/goal-decorations';
import { goalBoundaryGuard } from './ui/goal-guard';
import { GoalsPanel } from './ui/goals-panel';
import { clamp, wireDrag } from './ui/resize';
import { SessionPanel } from './ui/session-panel';

const FILE_PATH = `${DEFAULT_ALS_WORKSPACE}/Main.agda`;

// Assembled after the async backend boot; until then the commands are inert.
let backend: Backend | undefined;
let ctx: ExecuteContext | undefined;
let view: EditorView;

// --- panel visibility: body classes + toolbar toggle state ---

let sideShown = true;
let dockShown = true;

function toggleSide(): void {
  sideShown = !sideShown;
  document.body.classList.toggle('side-hidden', !sideShown);
  chrome.setShown('side', sideShown);
}

function toggleDock(): void {
  dockShown = !dockShown;
  document.body.classList.toggle('dock-hidden', !dockShown);
  chrome.setShown('dock', dockShown);
}

// --- save: one path — the file.save command, itself just the context's
// vfs-write seam (fs::sync). Every entry point (Mod-S, the palette row,
// the file-row icon) runs it; the UI disables it until the backend runs,
// and the command still refuses politely on the keyboard path. ---

function runSave(): void {
  commands.find(c => c.id === 'file.save')?.run(view);
}

// --- chrome + palette + commands, cross-referenced by closure ---

const chrome = new Chrome(document.getElementById('toolbar')!, {
  onOpenPalette: () => palette.open('all'),
  onToggleSide: toggleSide,
  onToggleDock: toggleDock,
});

const commands = buildCommands({
  getCtx: () => ctx,
  toggleSide,
  toggleDock,
  openPalette: mode => palette.open(mode),
});

const palette = new CommandPalette(document.getElementById('palette')!, {
  getCommands: () => commands,
  onRun: command => {
    command.run(view);
  },
  onClose: () => view.focus(),
});

const goalsPanel = new GoalsPanel(document.getElementById('goals-body')!, {
  onJumpGoal: goal => {
    view.dispatch({
      selection: { anchor: goal.from + HOLE_BOUNDARY },
      scrollIntoView: true,
    });
  },
});
const sessionPanel = new SessionPanel(document.getElementById('session-body')!, {
  onBackendStart: bootBackend,
  onBackendStop: stopBackend,
  onSaveFile: runSave,
});
const eventsPanel = new EventsPanel(document.getElementById('dock')!);

// Panel gaps are the resize handles: side width, session/goals split,
// dock height.
wireDrag(document.getElementById('side-resize')!, () => {
  const side = document.getElementById('side')!;
  const startW = side.offsetWidth;
  return ({ dx }) => {
    const w = clamp(startW - dx, 200, Math.floor(window.innerWidth * 0.6));
    side.style.width = `${w}px`;
  };
});
wireDrag(document.getElementById('panel-resize')!, () => {
  const side = document.getElementById('side')!;
  const session = side.querySelector<HTMLElement>('.panel-session')!;
  const startH = session.offsetHeight;
  return ({ dy }) => {
    session.style.flex = 'none';
    session.style.height = `${clamp(startH + dy, 80, side.offsetHeight - 80)}px`;
  };
});
wireDrag(document.getElementById('dock-resize')!, () => {
  const dock = document.getElementById('dock')!;
  const startH = dock.offsetHeight;
  return ({ dy }) => {
    dock.style.flex = 'none';
    dock.style.height = `${clamp(startH - dy, 60, window.innerHeight - 120)}px`;
  };
});

// Global shortcuts (palette, save) fire from any focus target; the
// editor-scoped keymap (bare Mod-C agda prefix) needs the selection.
wireGlobalKeys(window, {
  openPalette: () => palette.open('all'),
  saveFile: runSave,
});

view = new EditorView({
  state: EditorState.create({
    doc: '',
    extensions: [
      // Before basicSetup, so the bare Mod-C prefix wins over the
      // default keymap's copy (it still falls through with a selection).
      keymap.of([...appKeymap({ openPalette: mode => palette.open(mode) }), indentWithTab]),
      basicSetup,
      agda(),
      goalModelField,
      sessionModelField,
      observabilityModelField,
      filePathFacet.of(FILE_PATH),
      goalBoundaryGuard,
      goalDecorations,
      goalStyleTheme,
      // The whole UI is a projection: each update re-derives every
      // panel (all dirty-check before touching the DOM). An open
      // palette re-derives too — the backend coming online enables
      // its disabled rows.
      EditorView.updateListener.of(update => {
        goalsPanel.update(update.state);
        sessionPanel.update(update.state);
        eventsPanel.update(update.state);
        palette.sync();
      }),
    ],
  }),
  parent: document.getElementById('editor')!,
});

// updateListener runs on dispatches only — paint the booting state now.
sessionPanel.update(view.state);

// LSP wire events: every LSP frame both ways, plus each server error-stream
// line, lands in the observability log — commands only narrate what the
// wire cannot know (sync/stream elapse, failures, results).
// ALS runs under WebAssembly JSPI (WebAssembly.promising / Suspending),
// which is absent on iOS Safari — fail early with a clear reason instead of
// an opaque boot error.
const wasmJspi =
  (globalThis.WebAssembly as unknown as { promising?: unknown; Suspending?: unknown }).promising !==
    undefined &&
  (globalThis.WebAssembly as unknown as { promising?: unknown; Suspending?: unknown })
    .Suspending !== undefined;

// Ask for persistent storage: the precache (~30 MB) must survive browser
// storage pressure for the app to stay usable offline.
if (navigator.storage?.persist !== undefined) void navigator.storage.persist();

function bootBackend(): void {
  if (!wasmJspi) {
    view.dispatch(backendExitTransaction(1));
    console.error(
      'ALS boot failed: this browser does not support WebAssembly JSPI (Chrome 137+, Firefox 153+, Safari 27+).',
    );
    return;
  }
  view.dispatch(backendBootingTransaction());
  Backend.create({
    onLspFrame: (outgoing, msg) => view.dispatch(lspFrameEvent(outgoing, msg)),
    onLspLog: line => view.dispatch(lspLogEvent(line)),
    onLspExit: code => view.dispatch(backendExitTransaction(code)),
  })
    .then(b => {
      backend = b;
      ctx = new ExecuteContext(b, view);
      view.dispatch(backendOnlineTransaction());
    })
    .catch(err => {
      view.dispatch(backendExitTransaction(1));
      console.error(`ALS boot failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

function stopBackend(): void {
  backend?.terminate();
  backend = undefined;
  ctx = undefined;
  view.dispatch(backendExitTransaction(0));
}

bootBackend();

window.addEventListener('beforeunload', () => backend?.terminate());
