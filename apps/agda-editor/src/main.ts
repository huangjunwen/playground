import './main.css';
import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { DEFAULT_ALS_WORKSPACE } from '@playground/language-backend-agda';
import { Vim, vim } from '@replit/codemirror-vim';
import { basicSetup } from 'codemirror';
import { Backend } from './backend/backend';
import { ExecuteContext } from './integration/commands';
import { lspFrameEvent, lspLogEvent } from './integration/lsp-events';
import { agda } from './language/agda';
import { goalModelField, HOLE_BOUNDARY } from './model/goal-model';
import { observabilityModelField } from './model/observability-model';
import { loadPrefs, type Prefs, savePrefs, type ThemePref } from './model/prefs';
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
import { agdaChordRoot, buildCommands } from './ui/commands';
import { EventsPanel } from './ui/events-panel';
import { goalDecorations, goalStyleTheme } from './ui/goal-decorations';
import { goalBoundaryGuard } from './ui/goal-guard';
import { goalBackspaceCommand, goalVimDeleteCommand } from './ui/goal-keymap';
import { GoalsPanel } from './ui/goals-panel';
import { clamp, wireDrag } from './ui/resize';
import { SessionPanel } from './ui/session-panel';
import { applyTheme, watchSystemTheme } from './ui/theme';
import { clampVimCursor } from './ui/vim-cursor';

const FILE_PATH = `${DEFAULT_ALS_WORKSPACE}/Main.agda`;

// Assembled after the async backend boot; until then the commands are inert.
let backend: Backend | undefined;
let ctx: ExecuteContext | undefined;
let view: EditorView;

// --- user preferences (theme, vim) — persisted, projected into the
// commands' checked() marks, the toolbar icon, and the editor itself. ---

let prefs: Prefs = loadPrefs();

const vimCompartment = new Compartment();

function setTheme(theme: ThemePref): void {
  prefs = { ...prefs, theme };
  savePrefs(prefs);
  applyTheme(theme);
  chrome.setTheme(theme);
  palette.sync(); // the checked marks move with the preference
}

function toggleVim(): void {
  prefs = { ...prefs, vim: !prefs.vim };
  savePrefs(prefs);
  view.dispatch({
    effects: vimCompartment.reconfigure(prefs.vim ? [vim(), clampVimCursor] : []),
  });
  palette.sync();
}

const THEME_CYCLE: ThemePref[] = ['light', 'dark', 'system'];

function cycleTheme(): void {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(prefs.theme) + 1) % THEME_CYCLE.length]!;
  setTheme(next);
}

// 'system' keeps following the OS until the user pins a side.
watchSystemTheme(
  () => prefs.theme,
  () => chrome.setTheme(prefs.theme),
);

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

// Vim's :w/:write is just another save entry point — same command,
// same vfs-write seam.
Vim.defineEx('write', 'w', () => runSave());

// --- chrome + palette + commands, cross-referenced by closure ---

const chrome = new Chrome(document.getElementById('toolbar')!, {
  onCycleTheme: cycleTheme,
  onOpenPalette: () => palette.open(),
  onToggleSide: toggleSide,
  onToggleDock: toggleDock,
});
chrome.setTheme(prefs.theme);

const commands = buildCommands({
  getCtx: () => ctx,
  toggleSide,
  toggleDock,
  openPalette: prefix => palette.open(prefix),
  getTheme: () => prefs.theme,
  setTheme,
  isVim: () => prefs.vim,
  toggleVim,
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

// Global sequence dispatch: single-key bindings (Ctrl+S,
// Ctrl+Shift+P) run directly from any focus target; chord roots
// (Ctrl+C) open the palette as a filter. The editor-scoped keymap
// (same Mod-C root) handles the editor case, where CM's default
// keymap would otherwise swallow the key.
wireGlobalKeys(window, {
  getCommands: () => commands,
  run: command => command.run(view),
  openPalette: prefix => palette.open(prefix),
});

view = new EditorView({
  state: EditorState.create({
    doc: '',
    extensions: [
      // Before basicSetup, so the bare Mod-C chord root wins over the
      // default keymap's copy (it still falls through with a selection),
      // and before the vim extension, so the goal-boundary dance keys
      // (Backspace / x) get first refusal.
      keymap.of([
        ...appKeymap({ openChordRoot: () => palette.open(agdaChordRoot) }),
        { key: 'Backspace', run: goalBackspaceCommand },
        { key: 'x', run: goalVimDeleteCommand },
        indentWithTab,
      ]),
      basicSetup,
      agda(),
      vimCompartment.of(prefs.vim ? [vim(), clampVimCursor] : []),
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

// The index.html bootstrap set the attribute before first paint; from
// here on the app owns it (and the system watcher keeps 'system' live).
applyTheme(prefs.theme);

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
