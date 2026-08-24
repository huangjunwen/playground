// Als-wasm family: ensure declared assets exist on disk.
//
// Reads build params, writes output files into `outDir`, and returns
// a minimal asset descriptor map — no checksums here; the dispatcher
// handles SHA-256 calculation and assets.json recording.
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ensureBinaryen, runWasmOpt } from '../../helpers/binaryen.mjs';
import { curl } from '../../helpers/curl.mjs';

/** @param {string} p */
async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure all declared assets for this version exist on disk.
 *
 * @param {any} params  source + build descriptor.
 * @param {{ outDir: string }} ctx  Absolute output directory, guaranteed to exist.
 * @returns {Promise<Record<string, { filename: string; skipChecksum?: true }>>}
 */
export async function ensureVersion(params, { outDir }) {
  const { url, agdaVersion, binaryenVersion } = params;
  if (!url) throw new Error('als-wasm requires url');
  if (!agdaVersion) throw new Error('als-wasm requires agdaVersion');
  if (!binaryenVersion) throw new Error('als-wasm requires binaryenVersion');

  const optFile = `als-${agdaVersion}-opt.wasm`;
  const optPath = resolve(outDir, optFile);

  if (await fileExists(optPath)) {
    console.log(`opt wasm already present: ${optFile}`);
    return { opt: { filename: optFile } };
  }

  // The raw upstream wasm is a build-time intermediate only: download and
  // optimize from a scratch dir so the ~90MB unoptimized binary never lands
  // in vendor/ (everything under vendor/<family>/<version>/ ships to
  // browsers via the registry's url glob).
  const scratchDir = resolve(outDir, '..', '..', '.scratch');
  await mkdir(scratchDir, { recursive: true });
  const rawPath = resolve(scratchDir, `als-${agdaVersion}.wasm`);
  if (!(await fileExists(rawPath))) {
    console.log(`downloading raw wasm: ${url}`);
    curl(url, rawPath);
  }

  console.log(`ensuring binaryen ${binaryenVersion}...`);
  const wasmOpt = await ensureBinaryen(resolve(outDir, '..', '..', '.binaryen'), binaryenVersion);
  console.log('optimizing: wasm-opt -Oz');
  runWasmOpt(wasmOpt, '-Oz', rawPath, optPath);

  await rm(scratchDir, { recursive: true, force: true });

  console.log('OK: built 1 asset');
  return { opt: { filename: optFile } };
}
