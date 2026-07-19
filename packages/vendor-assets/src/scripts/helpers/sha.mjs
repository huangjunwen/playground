// SHA-256 helper for verifying on-disk files against checksum anchors.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Hex SHA-256 of the file at `file`. */
export async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}
