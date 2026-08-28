/**
 * Chrome — the toolbar: the app title on the left, the icon actions on
 * the right (palette first, then theme cycle, vim toggle, sidebar
 * toggle, logs toggle). The toggles' pressed state mirrors the panels'
 * visibility, main.ts owns that truth and pushes it in via setShown;
 * the theme button mirrors the persisted preference via setTheme (an
 * icon per mode), the vim button via setVim (the V lights while on).
 */

import type { ThemePref } from '../model/prefs';
import {
  commandIcon,
  monitorIcon,
  moonIcon,
  panelBottomIcon,
  panelRightIcon,
  sunIcon,
  vimIcon,
} from './icons';

export interface ChromeHooks {
  onCycleTheme(): void;
  onToggleVim(): void;
  onOpenPalette(): void;
  onToggleSide(): void;
  onToggleDock(): void;
}

export class Chrome {
  private readonly themeButton: HTMLButtonElement;
  private readonly vimButton: HTMLButtonElement;
  private readonly sideButton: HTMLButtonElement;
  private readonly dockButton: HTMLButtonElement;

  constructor(root: HTMLElement, hooks: ChromeHooks) {
    this.iconButton(root, 'btn-palette', commandIcon(), hooks.onOpenPalette);
    this.themeButton = this.iconButton(root, 'btn-theme', sunIcon(), hooks.onCycleTheme);
    this.vimButton = this.iconButton(root, 'btn-vim', vimIcon(), hooks.onToggleVim);
    this.sideButton = this.toggleButton(
      root,
      'btn-toggle-side',
      panelRightIcon(),
      hooks.onToggleSide,
    );
    this.dockButton = this.toggleButton(
      root,
      'btn-toggle-dock',
      panelBottomIcon(),
      hooks.onToggleDock,
    );
  }

  /** Reflect panel visibility in the toggle buttons' pressed state. */
  setShown(target: 'side' | 'dock', shown: boolean): void {
    const btn = target === 'side' ? this.sideButton : this.dockButton;
    btn.setAttribute('aria-pressed', String(shown));
    btn.classList.toggle('on', shown);
  }

  /** Reflect the theme preference in the cycle button (icon + label). */
  setTheme(pref: ThemePref): void {
    this.themeButton.replaceChildren(
      pref === 'light' ? sunIcon() : pref === 'dark' ? moonIcon() : monitorIcon(),
    );
    this.themeButton.title = `Color theme: ${pref} (click to change)`;
  }

  /** Reflect the vim preference in the toggle button — the V lights up while on. */
  setVim(on: boolean): void {
    this.vimButton.classList.toggle('on', on);
    this.vimButton.title = `Vim mode: ${on ? 'on' : 'off'} (click to change)`;
  }

  private iconButton(
    root: HTMLElement,
    id: string,
    icon: SVGSVGElement,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = root.querySelector<HTMLButtonElement>(`#${id}`)!;
    btn.append(icon);
    btn.addEventListener('click', onClick);
    return btn;
  }

  private toggleButton(
    root: HTMLElement,
    id: string,
    icon: SVGSVGElement,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = this.iconButton(root, id, icon, onClick);
    btn.setAttribute('aria-pressed', 'true');
    return btn;
  }
}
