/**
 * Browser support gate — the ALS backend needs WebAssembly JSPI, which
 * only ships in recent engines (and not at all on iOS Safari). Rather
 * than an opaque boot failure in the Session panel, an unsupported
 * browser gets a full-screen card naming exactly what is missing.
 */

interface SupportRequirement {
  ok: boolean;
  /** Human-readable description of the missing capability. */
  missing: string;
}

const wasi = globalThis.WebAssembly as
  | (typeof WebAssembly & { promising?: unknown; Suspending?: unknown })
  | undefined;

const REQUIREMENTS: SupportRequirement[] = [
  {
    ok: wasi !== undefined,
    missing: 'WebAssembly',
  },
  {
    ok: wasi?.promising !== undefined && wasi?.Suspending !== undefined,
    missing: 'WebAssembly JSPI (JavaScript Promise Integration)',
  },
];

/** The missing capabilities, empty when the browser can run the app. */
export function missingSupport(): string[] {
  return REQUIREMENTS.filter(r => !r.ok).map(r => r.missing);
}

/**
 * Blocking overlay card listing the missing capabilities. Intentionally
 * dismiss-free: without them the editor cannot type-check, so there is
 * nothing meaningful to continue to.
 */
export function showSupportCard(missing: string[]): void {
  const overlay = document.createElement('div');
  overlay.className = 'support-overlay';

  const card = document.createElement('div');
  card.className = 'support-card';

  const title = document.createElement('h1');
  title.textContent = 'This browser cannot run agda-editor';
  card.append(title);

  const list = document.createElement('ul');
  for (const item of missing) {
    const li = document.createElement('li');
    li.textContent = item;
    list.append(li);
  }
  card.append(list);

  const hint = document.createElement('p');
  hint.textContent =
    'The Agda language server needs WebAssembly JSPI — use Chrome or Edge 137+, Firefox 153+, or Safari 27+. Note that iOS Safari does not support JSPI.';
  card.append(hint);

  overlay.append(card);
  document.body.append(overlay);
}
