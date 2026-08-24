/**
 * Resize drag — shared pointer-drag helper for the panel resize handles
 * (dock height, sidebar width). `onDragStart` runs at mouse-down and
 * returns the per-move callback (closure over start dimensions), which
 * receives deltas from the drag origin.
 */

export interface DragDelta {
  dx: number;
  dy: number;
}

export function wireDrag(handle: HTMLElement, onDragStart: () => (delta: DragDelta) => void): void {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const onMove = onDragStart();
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: MouseEvent): void => {
      onMove({ dx: ev.clientX - startX, dy: ev.clientY - startY });
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

/** Clamp a resize value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
