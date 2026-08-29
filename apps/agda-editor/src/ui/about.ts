/**
 * About dialog — build provenance (commit id) shown behind the
 * `Help: About agda-editor` command instead of sitting in the toolbar.
 * Dismissed by Escape, the backdrop, or the close button.
 */

export class About {
  private readonly root: HTMLDivElement;

  constructor() {
    const overlay = document.createElement('div');
    overlay.className = 'support-overlay';
    overlay.hidden = true;

    const card = document.createElement('div');
    card.className = 'support-card';

    const title = document.createElement('h1');
    title.textContent = 'agda-editor';
    card.append(title);

    const blurb = document.createElement('p');
    blurb.textContent = 'An interactive Agda proof editor that runs entirely in the browser.';
    card.append(blurb);

    const commit = document.createElement('p');
    commit.className = 'about-commit';
    const code = document.createElement('code');
    code.textContent = __APP_COMMIT__;
    commit.append('Built from commit ', code);
    card.append(commit);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'about-close';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    card.append(close);

    overlay.append(card);
    document.body.append(overlay);

    overlay.addEventListener('mousedown', e => {
      if (e.target === overlay) this.close();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !overlay.hidden) {
        e.preventDefault();
        this.close();
      }
    });

    this.root = overlay;
  }

  open(): void {
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
  }
}
