/**
 * Source position / interval / range types — shared by the command side and
 * the response side of the ALS protocol.
 *
 * Field names (`pos`, `line`, `col`) match the JSONTop `Position' ()` encoder
 * (Agda Interaction/JSONTop.hs). All values are 1-based integers.
 *
 * Command side: `serializeRange([])` serializes to the IOTCM sentinel `noRange`;
 * a non-empty range serializes to
 *   intervalsToRange Nothing [Interval () (Pn () pos line col) ...]
 * The range file slot is pinned to `Nothing` because ALS's `parseIOTCM`
 * patches it from the IOTCM envelope's file path, so an explicit
 * `Just (mkAbsolute ...)` is redundant.
 */

/** 1-based source position. */
export interface Position {
  pos: number;
  line: number;
  col: number;
}

/** Half-open [start, end) source interval. */
export interface Interval {
  start: Position;
  end: Position;
}

/**
 * Source range as a list of intervals. `[]` denotes `noRange`
 * (no interaction range selected), matching the response-side convention.
 */
export type Range = Interval[];

/** Serialize a range to the IOTCM wire format. */
export function serializeRange(range: Range): string {
  if (range.length === 0) return 'noRange';
  const intervals = range
    .map(
      i =>
        `Interval () (Pn () ${i.start.pos} ${i.start.line} ${i.start.col}) ` +
        `(Pn () ${i.end.pos} ${i.end.line} ${i.end.col})`,
    )
    .join(', ');
  return `intervalsToRange Nothing [${intervals}]`;
}
