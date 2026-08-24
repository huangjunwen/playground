/**
 * Coordinate helpers converting between CodeMirror's 0-based offsets and
 * agda's 1-based positions (pos / line / col, all 1-based).
 */

import type { Text } from '@codemirror/state';

/** 1-based source position as reported by agda. */
export interface Position1 {
  pos: number;
  line: number;
  col: number;
}

/** A half-open interval in 1-based coordinates. */
export interface Interval1 {
  start: Position1;
  end: Position1;
}

/** Map a 0-based offset to the 1-based pos/line/col triple (O(log n)). */
export function posAt(doc: Text, idx0: number): Position1 {
  const line = doc.lineAt(idx0);
  return { pos: idx0 + 1, line: line.number, col: idx0 - line.from + 1 };
}

/** Map a 0-based range to a 1-based half-open interval. */
export function span(doc: Text, from0: number, to0: number): Interval1[] {
  return [{ start: posAt(doc, from0), end: posAt(doc, to0) }];
}
