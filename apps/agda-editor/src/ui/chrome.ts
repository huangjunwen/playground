/**
 * Chrome — the toolbar: the command buttons, wired to their callbacks.
 * The boot state only disables them; every status narration lives in
 * the session panel.
 */

export interface ChromeHooks {
  onLoad(): void;
  onGive(): void;
  onNextGoal(): void;
}

export class Chrome {
  private readonly buttons: readonly HTMLButtonElement[];

  constructor(root: HTMLElement, hooks: ChromeHooks) {
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-command]')];
    for (const btn of this.buttons) {
      const cmd = btn.dataset.command;
      if (cmd === 'load') btn.addEventListener('click', hooks.onLoad);
      else if (cmd === 'give') btn.addEventListener('click', hooks.onGive);
      else if (cmd === 'next-goal') btn.addEventListener('click', hooks.onNextGoal);
    }
    this.setReady(false);
  }

  /** Buttons stay disabled until the backend is up. */
  setReady(ready: boolean): void {
    for (const btn of this.buttons) btn.disabled = !ready;
  }
}
