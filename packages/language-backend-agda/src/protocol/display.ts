/**
 * Display formatting for the goal-shaped protocol payloads — a faithful
 * port of agda's own rendering, so every line reads exactly like the one
 * an agda-mode user knows:
 * - `renderGoal`: BasicOps.hs `Pretty OutputConstraint` (the per-constraint
 *   pretty instances)
 * - `formatRange`: `prettyShow Range` (the `l.c-c` / `l.c-l.c` form)
 * - `formatAllGoals`: BasicOps.hs `showGoals` — the *All Goals* buffer
 *   layout (visible goals first, then hidden metas with their position;
 *   the one-word *All Done* buffer when the snapshot is empty)
 * - `collectVisibleGoalTypes`: the id → type extraction from a
 *   visible-goal snapshot (only `OfType`/`JustSort` constraints on
 *   interaction points carry a usable pair)
 *
 * Keeping this beside the protocol types it renders: the upstream pretty
 * instances live beside the Haskell types too, and when agda grows a new
 * constraint shape, the type and its rendering change in one place.
 */

import type { Range } from './range';
import type { ConstraintObj, OutputConstraint } from './responses';

/** Interaction points print as `?N`; hidden metas keep their (already underscore-prefixed) name. */
function obj(o: ConstraintObj): string {
  return 'id' in o ? `?${o.id}` : o.name;
}

function cmp(parts: string[], comparison: string): string {
  return parts.join(` ${comparison} `);
}

/**
 * Render one constraint the way agda's own pretty instances do
 * (BasicOps.hs `Pretty OutputConstraint`). Not exhaustive of the payload:
 * fields with no printed form (e.g. FindInstanceOF's candidates,
 * PostponedCheckFunDef's error) are skipped, as upstream does.
 */
export function renderGoal(constraint: OutputConstraint): string {
  const c = constraint;
  switch (c.kind) {
    case 'OfType':
      return `${obj(c.constraintObj)} : ${c.type}`;
    case 'JustType':
      return `Type ${obj(c.constraintObj)}`;
    case 'JustSort':
      return `Sort ${obj(c.constraintObj)}`;
    case 'CmpInType':
      return `${cmp(c.constraintObjs.map(obj), c.comparison)} : ${c.type}`;
    case 'CmpTypes':
    case 'CmpLevels':
    case 'CmpTeles':
    case 'CmpSorts':
      return cmp(c.constraintObjs.map(obj), c.comparison);
    case 'CmpElim':
      // JSONTop carries polarities instead of a comparison operator here.
      return `${cmp(
        c.constraintObjs.map(row => obj(row[0]!)),
        c.polarities.join(' '),
      )} : ${c.type}`;
    case 'Assign':
      return `${obj(c.constraintObj)} := ${c.value}`;
    case 'TypedAssign':
      return `${obj(c.constraintObj)} := ${c.value} :? ${c.type}`;
    case 'PostponedCheckArgs':
      return `${obj(c.constraintObj)} := (_ : ${c.ofType} ${c.arguments.join(' ')}) : ${c.type}`;
    case 'IsEmptyType':
      return `Is empty: ${c.type}`;
    case 'SizeLtSat':
      return `Not empty type of sizes: ${c.type}`;
    case 'FindInstanceOF':
      return `Resolve instance argument ${obj(c.constraintObj)} : ${c.type}`;
    case 'ResolveInstanceOF':
      return `Resolve output type of instance ${c.name}`;
    case 'PTSInstance':
      return `PTS instance for (${c.constraintObjs.map(obj).join(', ')})`;
    case 'PostponedCheckFunDef':
      return `Check definition of ${c.name} : ${c.type}`;
    case 'DataSort':
      return `Sort ${c.sort} allows data/record definitions`;
    case 'CheckLock':
      return `Check lock ${c.lock} allows ${c.head}`;
    case 'UsableAtMod':
      return `Is usable at ${c.mod} modality: ${c.term}`;
  }
}

/** `l.c-c` / `l.c-l.c` per interval, comma-joined — agda's `prettyShow Range`. */
export function formatRange(range: Range): string {
  return range
    .map(i =>
      i.start.line === i.end.line
        ? `${i.start.line}.${i.start.col}-${i.end.col}`
        : `${i.start.line}.${i.start.col}-${i.end.line}.${i.end.col}`,
    )
    .join(',');
}

/** A hidden meta's position suffix (`showA'` in BasicOps.hs): two spaces, `at`, the range. */
function atSuffix(range: Range): string {
  return range.length > 0 ? `  [ at ${formatRange(range)} ]` : '';
}

/** The hidden-meta position: the NamedMeta's range, none for interaction points. */
function metaRange(constraint: OutputConstraint): Range {
  return 'constraintObj' in constraint && !('id' in constraint.constraintObj)
    ? constraint.constraintObj.range
    : [];
}

/**
 * AllGoalsWarnings snapshot → the *All Goals* buffer's lines (BasicOps.hs
 * `showGoals`): one line per visible goal, then the hidden metas with
 * their `[ at l.c ]` position; an empty snapshot is the *All Done*
 * buffer's one word.
 */
export function formatAllGoals(snapshot: {
  visibleGoals: OutputConstraint[];
  invisibleGoals: OutputConstraint[];
}): string[] {
  if (snapshot.visibleGoals.length === 0 && snapshot.invisibleGoals.length === 0) {
    return ['All Done'];
  }
  return [
    ...snapshot.visibleGoals.map(renderGoal),
    ...snapshot.invisibleGoals.map(g => renderGoal(g) + atSuffix(metaRange(g))),
  ];
}

/**
 * Visible-goal snapshot → the id → type map a goal list is built from.
 * Upstream only ever produces `OfType` or `JustSort` for visible metas
 * (BasicOps.hs `typesOfVisibleMetas`/`rewriteJudg`); `OfType` carries the
 * type expression, `JustSort` renders as `Sort ?N`. Other shapes live in
 * the hidden-metas list and have no interaction id, so they are skipped.
 * Returns a fresh map per call — AllGoalsWarnings is a full snapshot of
 * the visible goals, so when a stream carries several, the last one is
 * the current state.
 */
export function collectVisibleGoalTypes(visibleGoals: OutputConstraint[]): Map<number, string> {
  const typesById = new Map<number, string>();
  for (const goal of visibleGoals) {
    if (goal.kind === 'OfType' && 'id' in goal.constraintObj) {
      typesById.set(goal.constraintObj.id, goal.type);
    } else if (goal.kind === 'JustSort' && 'id' in goal.constraintObj) {
      typesById.set(goal.constraintObj.id, renderGoal(goal));
    }
  }
  return typesById;
}
