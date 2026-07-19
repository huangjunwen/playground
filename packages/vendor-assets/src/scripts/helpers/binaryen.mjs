// binaryen (wasm-opt) toolchain cache + invocation helper.
//
// Ensures a pinned binaryen release is downloaded, verified against its
// official .sha256 sidecar, and extracted under `<cacheDir>/binaryen-<version>/`.
// Family fetch modules call `runWasmOpt` to invoke the cached binary.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { curl } from './curl.mjs';
import { sha256File } from './sha.mjs';

const BINARYEN_BASE = 'https://github.com/WebAssembly/binaryen/releases/download';

/** Map the current host to the binaryen release asset suffix. */
function binaryenAsset(version) {
  const { platform, arch } = process;
  const os =
    platform === 'linux'
      ? 'linux'
      : platform === 'darwin'
        ? 'macos'
        : platform === 'win32'
          ? 'windows'
          : null;
  if (!os) throw new Error(`unsupported platform: ${platform}`);
  // linux arm64 = "aarch64"; macos/windows arm64 = "arm64"; x64 = "x86_64".
  const cpu =
    arch === 'x64'
      ? 'x86_64'
      : arch === 'arm64'
        ? platform === 'linux'
          ? 'aarch64'
          : 'arm64'
        : null;
  if (!cpu) throw new Error(`unsupported arch: ${arch}`);
  return `binaryen-${version}-${cpu}-${os}.tar.gz`;
}

/**
 * Ensure the pinned binaryen toolchain is extracted under `<cacheDir>/binaryen-<version>/`.
 * Downloads the tarball + official .sha256 sidecar, verifies the tarball against
 * the sidecar, extracts (tar creates a binaryen-<version>/ top dir), then removes
 * the tarball/sidecar. Returns the absolute wasm-opt path.
 *
 * @param {string} cacheDir  Directory to cache the toolchain under.
 * @param {string} version   Pinned binaryen release tag (e.g. "version_130").
 * @returns {Promise<string>} Absolute path to the wasm-opt binary.
 */
export async function ensureBinaryen(cacheDir, version) {
  const exe = process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
  const extractRoot = resolve(cacheDir, `binaryen-${version}`);
  const wasmOpt = resolve(extractRoot, 'bin', exe);
  if (existsSync(wasmOpt)) return wasmOpt;

  await mkdir(cacheDir, { recursive: true });
  const asset = binaryenAsset(version);
  const tarball = resolve(cacheDir, asset);
  const sidecar = resolve(cacheDir, `${asset}.sha256`);
  const tarUrl = `${BINARYEN_BASE}/${version}/${asset}`;
  console.log(`downloading binaryen ${version}: ${asset}`);
  curl(tarUrl, tarball);
  curl(`${tarUrl}.sha256`, sidecar);

  // Verify the tarball against the official sidecar (format: "<sha>  <name>").
  const expected = (await readFile(sidecar, 'utf8')).trim().split(/\s+/)[0];
  const actual = await sha256File(tarball);
  if (actual !== expected) throw new Error(`binaryen sidecar mismatch: ${actual} != ${expected}`);

  // Extract (creates binaryen-<version>/ as the top directory).
  const xr = spawnSync('tar', ['-xzf', tarball, '-C', cacheDir], { stdio: 'inherit' });
  if (xr.status !== 0) throw new Error(`tar extract failed (exit ${xr.status})`);
  if (!existsSync(wasmOpt)) throw new Error(`extraction ok but ${wasmOpt} not found`);
  await rm(tarball, { force: true });
  await rm(sidecar, { force: true });
  return wasmOpt;
}

/**
 * Run `wasm-opt <flags> <inFile> -o <outFile>` against the cached toolchain.
 * Throws on non-zero exit.
 *
 * @param {string} wasmOpt  Absolute path returned by ensureBinaryen().
 * @param {string} flags    wasm-opt flags (e.g. "-Oz").
 * @param {string} inFile   Input wasm path.
 * @param {string} outFile  Output wasm path.
 */
export function runWasmOpt(wasmOpt, flags, inFile, outFile) {
  const r = spawnSync(wasmOpt, [flags, inFile, '-o', outFile], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`wasm-opt failed (exit ${r.status})`);
}
