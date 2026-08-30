/**
 * Toast — the transient banner for "nothing happened" feedback (a give
 * with no goal under the cursor, a chord run with the backend offline,
 * …). The observability event still lands in the logs, but the dock may
 * be closed or filtered away, so the same note is echoed over the editor
 * and fades out.
 *
 * DOM-direct, not a CM6 StateField: the toast is ephemeral chrome, not
 * document state. A single element is reused — a rapid second warning
 * replaces the first and restarts the timer instead of stacking. No-ops
 * without a DOM (node tests drive the commands directly); the log event
 * remains the durable record there.
 */

const TOAST_MS = 3000;

let element: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string): void {
  if (typeof document === 'undefined') return; // node tests: the log event is the record
  const host = document.getElementById('editor');
  if (host === null) return;
  if (element === undefined || !element.isConnected) {
    element = document.createElement('div');
    element.id = 'toast';
    element.setAttribute('role', 'status');
    host.appendChild(element);
  }
  element.textContent = text;
  element.classList.add('show');
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => element?.classList.remove('show'), TOAST_MS);
}
