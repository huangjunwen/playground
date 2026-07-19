// Per-family asset ensure dispatcher.
//
// Discovers families under families/*/, dynamic-imports each family's
// ensure.mjs, calls `ensureVersion(params, { outDir })` to build assets,
// then handles SHA-256 checksums: verifies against assets.json for existing
// entries, or records new ones.
//
// Usage:
//   node src/scripts/ensure-assets.mjs --family als-wasm                  # family defaultVersion
//   node src/scripts/ensure-assets.mjs --family als-wasm --version v6     # fully specific
//   node src/scripts/ensure-assets.mjs --family als-wasm --all             # every version
//   node src/scripts/ensure-assets.mjs --all                               # every family × every version
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from './helpers/sha.mjs';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '../..');
const familiesDir = resolve(here, 'families');
const vendorDir = resolve(pkgRoot, 'vendor');

// ---- args -----------------------------------------------------------------

const args = process.argv.slice(2);
const all = args.includes('--all');
const familyIdx = args.indexOf('--family');
const versionIdx = args.indexOf('--version');
const family = familyIdx !== -1 ? args[familyIdx + 1] : null;
const version = versionIdx !== -1 ? args[versionIdx + 1] : null;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`usage: node src/scripts/ensure-assets.mjs [--family <name> [--version <v> | --all]] | --all`);
  process.exit(0);
}

// ---- family discovery -----------------------------------------------------

async function listFamilyDirs() {
  const entries = await readdir(familiesDir, { withFileTypes: true });
  return entries.filter((d) => d.isDirectory()).map((d) => d.name);
}

async function readParams(family) {
  return JSON.parse(await readFile(resolve(familiesDir, family, 'params.json'), 'utf8'));
}

async function readAssets(family) {
  try {
    return JSON.parse(await readFile(resolve(familiesDir, family, 'assets.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function writeAssets(family, assets) {
  const path = resolve(familiesDir, family, 'assets.json');
  await writeFile(path, JSON.stringify(assets, null, 2) + '\n', 'utf8');
}

// ---- pair selection -------------------------------------------------------

async function selectPairs() {
  const familyDirs = await listFamilyDirs();
  if (all) {
    const pairs = [];
    for (const f of familyDirs) {
      const p = await readParams(f);
      for (const v of Object.keys(p.versions)) pairs.push([f, v]);
    }
    if (pairs.length === 0) throw new Error('no versions registered in any family');
    return pairs;
  }
  if (!family) {
    throw new Error('specify --family <name> (or --all). See --help.');
  }
  if (!familyDirs.includes(family)) {
    throw new Error(`unknown family: ${family}. Known: ${familyDirs.join(', ')}.`);
  }
  const p = await readParams(family);
  if (version) {
    if (!p.versions[version]) {
      throw new Error(`unknown version: ${family}@${version}. Known: ${Object.keys(p.versions).join(', ')}.`);
    }
    return [[family, version]];
  }
  return [[family, p.defaultVersion]];
}

// ---- driver ---------------------------------------------------------------

const pairs = await selectPairs();
console.log(`ensuring: ${pairs.map(([f, v]) => `${f}@${v}`).join(', ')}`);

let errors = 0;

for (const [f, v] of pairs) {
  const params = await readParams(f);
  const versionParams = params.versions[v];
  if (!versionParams) throw new Error(`unknown version: ${f}@${v}`);

  const outDir = resolve(vendorDir, f, v);
  await mkdir(outDir, { recursive: true });

  console.log(`\n=== ${f}@${v} ===`);

  // 1. Build.
  const mod = await import(`./families/${f}/ensure.mjs`);
  if (typeof mod.ensureVersion !== 'function') {
    throw new Error(`families/${f}/ensure.mjs must export ensureVersion(params, ctx)`);
  }
  const built = await mod.ensureVersion(versionParams, { outDir });

  // 2. Checksum.
  const existingAssets = await readAssets(f);
  const existingVersionAssets = existingAssets[v] ?? {};
  const updatedVersionAssets = {};

  for (const [assetId, desc] of Object.entries(built)) {
    const filePath = resolve(outDir, desc.filename);
    const existing = existingVersionAssets[assetId];

    if (desc.skipChecksum) {
      console.log(`skip checksum: ${assetId} vendor/${f}/${v}/${desc.filename}`);
      updatedVersionAssets[assetId] = { filename: desc.filename };
      continue;
    }

    const sha = await sha256File(filePath);
    const { size } = await stat(filePath);

    if (existing?.sha256) {
      if (sha !== existing.sha256) {
        console.error(`FAIL ${assetId}: ${sha} != assets.json ${existing.sha256}`);
        errors++;
      } else {
        console.log(`OK   ${assetId}: vendor/${f}/${v}/${desc.filename} (${mb(size)}, ${sha})`);
      }
    } else {
      console.log(`NEW  ${assetId}: vendor/${f}/${v}/${desc.filename} (${mb(size)}, ${sha})`);
    }

    updatedVersionAssets[assetId] = { filename: desc.filename, sha256: sha, sizeBytes: size };
  }

  existingAssets[v] = updatedVersionAssets;
  await writeAssets(f, existingAssets);
}

if (errors > 0) {
  console.error(`\n${errors} checksum mismatch(es).`);
  process.exit(1);
}

console.log('\nassets.json updated.');
