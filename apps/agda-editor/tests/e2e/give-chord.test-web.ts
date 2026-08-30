/**
 * Repro — C-c C-space (give) appears dead while C-c C-l (load) works.
 * Drives the real CommandPalette DOM projection: open at the chord
 * root, then a real Ctrl+Space keydown on the focused input.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../../src/ui/command-palette';
import { buildCommands, type CommandEnv, modKey } from '../../src/ui/commands';

let root: HTMLElement | undefined;

afterEach(() => {
  root?.remove();
  root = undefined;
});

function mountPalette(): { palette: CommandPalette; onRun: ReturnType<typeof vi.fn> } {
  root = document.createElement('div');
  root.className = 'palette';
  root.hidden = true;
  root.innerHTML = `
    <div class="palette-panel" role="dialog">
      <input class="palette-input" autocomplete="off" spellcheck="false" />
      <div class="palette-hint" hidden></div>
      <div class="palette-list" role="listbox"></div>
    </div>`;
  document.body.append(root);

  const stubEnv: CommandEnv = {
    getCtx: () => ({}) as never, // backend online so give is enabled
    toggleSide: () => {},
    toggleDock: () => {},
    openPalette: () => {},
    getTheme: () => 'system',
    setTheme: () => {},
    isVim: () => false,
    toggleVim: () => {},
    openAbout: () => {},
  };
  const onRun = vi.fn();
  const onClose = vi.fn();
  const palette = new CommandPalette(root, {
    getCommands: () => buildCommands(stubEnv),
    onRun,
    onClose,
  });
  return { palette, onRun };
}

function keydown(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('C-c C-space chord through the real palette', () => {
  it('completes to agda.give from the chord root', () => {
    const { palette, onRun } = mountPalette();
    palette.open(`${modKey}+C`);
    const input = document.querySelector<HTMLInputElement>('.palette-input')!;

    // what a real Ctrl+Space looks like without IME interference
    const e = keydown(input, { key: ' ', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(onRun).toHaveBeenCalledOnce();
    expect(onRun.mock.calls[0]![0].id).toBe('agda.give');
    expect(palette.isOpen()).toBe(false);
  });

  it('C-l still completes to agda.load (control case)', () => {
    const { palette, onRun } = mountPalette();
    palette.open(`${modKey}+C`);
    const input = document.querySelector<HTMLInputElement>('.palette-input')!;

    keydown(input, { key: 'l', ctrlKey: true });
    expect(onRun.mock.calls[0]![0].id).toBe('agda.load');
  });

  it('an IME-processed key ("Process") still gives via the code fallback', () => {
    const { palette, onRun } = mountPalette();
    palette.open(`${modKey}+C`);
    const input = document.querySelector<HTMLInputElement>('.palette-input')!;

    // what fcitx/ibus deliver when their Ctrl+Space toggle is claimed
    const e = keydown(input, { key: 'Process', code: 'Space', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(onRun).toHaveBeenCalledOnce();
    expect(onRun.mock.calls[0]![0].id).toBe('agda.give');
    expect(palette.isOpen()).toBe(false);
  });
});
