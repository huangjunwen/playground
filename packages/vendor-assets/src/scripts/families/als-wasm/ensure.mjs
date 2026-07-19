// Als-wasm family: ensure declared assets exist on disk.
//
// Reads build params, writes output files into `outDir`, and returns
// a minimal asset descriptor map — no checksums here; the dispatcher
// handles SHA-256 calculation and assets.json recording.
import { stat } from 'node:fs/promises';
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

  const rawFile = `als-${agdaVersion}.wasm`;
  const optFile = `als-${agdaVersion}-opt.wasm`;
  const rawPath = resolve(outDir, rawFile);
  const optPath = resolve(outDir, optFile);

  // 1. Ensure raw file exists.
  if (await fileExists(rawPath)) {
    console.log(`raw wasm already present: ${rawFile}`);
  } else {
    console.log(`downloading raw wasm: ${url}`);
    curl(url, rawPath);
  }

  // 2. Ensure opt file exists.
  if (await fileExists(optPath)) {
    console.log(`opt wasm already present: ${optFile}`);
  } else {
    console.log(`ensuring binaryen ${binaryenVersion}...`);
    const wasmOpt = await ensureBinaryen(resolve(outDir, '..', '..', '.binaryen'), binaryenVersion);
    console.log(`optimizing: wasm-opt -Oz`);
    runWasmOpt(wasmOpt, '-Oz', rawPath, optPath);
  }

  console.log(`OK: built 2 assets`);
  return {
    raw: { filename: rawFile },
    opt: { filename: optFile },
  };
}
