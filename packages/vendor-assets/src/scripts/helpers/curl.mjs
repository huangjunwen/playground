// curl wrapper that respects standard proxy env vars.
//
// `-C -` resumes from a partial file left by a previous interrupted run.
// `--retry-all-errors` makes curl retry through transient proxy hiccups
// (DNS/SSL/connection drops), not just HTTP-level errors.
import { spawnSync } from 'node:child_process';

/**
 * Download `url` to `outFile` via curl. Throws on non-zero exit.
 * @param {string} url
 * @param {string} outFile
 */
export function curl(url, outFile) {
  const r = spawnSync(
    'curl',
    ['-fSL', '--retry', '10', '--retry-delay', '3', '--retry-all-errors', '-C', '-', '-o', outFile, url],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`curl failed for ${url} (exit ${r.status})`);
}
