/** Agda IOTCM command string constants — wire-format parameter values. */

/** Sentinel: no interaction range is selected. */
export const NO_RANGE = 'noRange';

// ---- Rewrite modes (ordered ascendingly by degree of normalization) ----

/** Goal rewriter mode: leave goals unchanged. */
export const REWRITE_AS_IS = 'AsIs' as const;
/** Goal rewriter mode: instantiate metas. */
export const REWRITE_INSTANTIATED = 'Instantiated' as const;
/** Goal rewriter mode: reduce to head normal form. */
export const REWRITE_HEAD_NORMAL = 'HeadNormal' as const;
/** Goal rewriter mode: simplify. */
export const REWRITE_SIMPLIFIED = 'Simplified' as const;
/** Goal rewriter mode: full normalisation. */
export const REWRITE_NORMALISED = 'Normalised' as const;

// ---- UseForce ----

/** Cmd_give: only insert when the expression type-checks (default). */
export const FORCE_WITHOUT = 'WithoutForce' as const;
/** Cmd_give: insert even if it does not type-check. */
export const FORCE_WITH = 'WithForce' as const;

// ---- ComputeMode ----

/** Cmd_compute normalisation modes. */
export const COMPUTE_DEFAULT = 'DefaultCompute' as const;
export const COMPUTE_HEAD = 'HeadCompute' as const;
export const COMPUTE_NORMALISED = 'NormalisedCompute' as const;
export const COMPUTE_IGNORE_ABSTRACT = 'IgnoreAbstract' as const;
export const COMPUTE_USE_SHOW_INSTANCE = 'UseShowInstance' as const;

// ---- Cmd_tokenHighlighting Remove flag ----

/** Remove the source file after reading. */
export const REMOVE_FILE = 'Remove' as const;
/** Keep the source file after reading. */
export const KEEP_FILE = 'Keep' as const;
