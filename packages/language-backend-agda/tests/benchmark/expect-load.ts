import { expect } from 'vitest';

/**
 * Response kinds a successful `cmdLoad` must contain — established from a real
 * run: Status/ClearRunningInfo/ClearHighlighting/RunningInfo/HighlightingInfo/
 * DisplayInfo/InteractionPoints/End, with zero Error/JumpToError.
 *
 * Guarantees the measured load actually type-checked the source and produced
 * interactive output (highlights, goal display, interaction points) rather than
 * silently completing with a failure/empty response set — otherwise the
 * benchmark would time an empty run.
 */
const REQUIRED_KINDS = ['HighlightingInfo', 'DisplayInfo', 'InteractionPoints', 'End'] as const;

interface LoadResponse {
  kind?: string;
  direct?: boolean;
  info?: { payload?: unknown[] };
}

/**
 * Assert a `cmdLoad` response is a real, meaningful result: the key response
 * kinds are present, highlight atoms were actually produced, and the load
 * reported no errors. `label` names the source in failure messages.
 */
export function expectLoadResult(resp: LoadResponse[], label: string): void {
  expect(resp, `cmdLoad ${label} returned no responses`).toBeInstanceOf(Array);
  expect(resp.length, `cmdLoad ${label} returned empty response`).toBeGreaterThan(0);

  const kinds = new Set(resp.map(r => r.kind));
  for (const kind of REQUIRED_KINDS) {
    expect(kinds.has(kind), `cmdLoad ${label} is missing a ${kind} response`).toBe(true);
  }

  const withHighlight = resp.find(r => r.kind === 'HighlightingInfo' && r.direct === true);
  expect(
    withHighlight?.info?.payload?.length,
    `cmdLoad ${label} returned HighlightingInfo with no highlight atoms`,
  ).toBeGreaterThan(0);

  const errors = resp.filter(r => r.kind === 'Error' || r.kind === 'JumpToError');
  expect(errors, `cmdLoad ${label} returned ${errors.length} Error responses`).toEqual([]);
}
