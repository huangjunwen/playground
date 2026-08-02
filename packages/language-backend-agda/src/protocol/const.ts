/** Agda IOTCM command string constants — wire-format parameter values. */

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

/** Valid values for IOTCM `rewriteMode` parameters. */
export type RewriteMode =
  | typeof REWRITE_AS_IS
  | typeof REWRITE_INSTANTIATED
  | typeof REWRITE_HEAD_NORMAL
  | typeof REWRITE_SIMPLIFIED
  | typeof REWRITE_NORMALISED;

// ---- UseForce ----

/** Cmd_give: only insert when the expression type-checks (default). */
export const FORCE_WITHOUT = 'WithoutForce' as const;
/** Cmd_give: insert even if it does not type-check. */
export const FORCE_WITH = 'WithForce' as const;

/** Valid values for IOTCM `useForce` parameters. */
export type ForceMode = typeof FORCE_WITHOUT | typeof FORCE_WITH;

// ---- ComputeMode ----

/** Cmd_compute normalisation modes. */
export const COMPUTE_DEFAULT = 'DefaultCompute' as const;
export const COMPUTE_HEAD = 'HeadCompute' as const;
export const COMPUTE_NORMALISED = 'NormalisedCompute' as const;
export const COMPUTE_IGNORE_ABSTRACT = 'IgnoreAbstract' as const;
export const COMPUTE_USE_SHOW_INSTANCE = 'UseShowInstance' as const;

/** Valid values for IOTCM `computeMode` parameters. */
export type ComputeMode =
  | typeof COMPUTE_DEFAULT
  | typeof COMPUTE_HEAD
  | typeof COMPUTE_NORMALISED
  | typeof COMPUTE_IGNORE_ABSTRACT
  | typeof COMPUTE_USE_SHOW_INSTANCE;

// ---- Cmd_tokenHighlighting Remove flag ----

/** Remove the source file after reading. */
export const REMOVE_FILE = 'Remove' as const;
/** Keep the source file after reading. */
export const KEEP_FILE = 'Keep' as const;

/** Valid values for the IOTCM `remove` flag. */
export type RemoveFlag = typeof REMOVE_FILE | typeof KEEP_FILE;

// ---- HighlightingLevel ----

/** IOTCM highlighting level: suppress highlighting entirely. */
export const HIGHLIGHTING_NONE = 'None' as const;
/** IOTCM highlighting level: send non-interactive highlighting (default). */
export const HIGHLIGHTING_NON_INTERACTIVE = 'NonInteractive' as const;
/** IOTCM highlighting level: also highlight the currently type-checked expression. */
export const HIGHLIGHTING_INTERACTIVE = 'Interactive' as const;

/**
 * How much highlighting the IOTCM response should include.
 * `None` suppresses highlighting entirely (no HighlightingInfo responses).
 */
export type HighlightingLevel =
  | typeof HIGHLIGHTING_NONE
  | typeof HIGHLIGHTING_NON_INTERACTIVE
  | typeof HIGHLIGHTING_INTERACTIVE;
