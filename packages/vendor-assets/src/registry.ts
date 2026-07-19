/**
 * Vendored asset registry — narrow lookup surface over every family's
 * assets.json and every file under `vendor/`. 
 */

/** A single declared asset (e.g. raw or optimized wasm). */
export interface AssetEntry {
  /** On-disk filename under `vendor/<family>/<version>/`. */
  filename: string;
  /** Hex SHA-256 anchor (absent for non-reproducible assets). */
  sha256?: string;
  /** Recorded size in bytes (absent for non-reproducible assets). */
  sizeBytes?: number;
}

// ---- static globs ----------------------------------------------------------

const _params = import.meta.glob('./scripts/families/*/params.json', {
  eager: true,
  import: 'default',
}) as Record<string, { defaultVersion: string }>;

const _assets = import.meta.glob('./scripts/families/*/assets.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, Record<string, AssetEntry>>>;

const _urls = import.meta.glob('../vendor/*/*/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// ---- internal indices ------------------------------------------------------

function familyFromKey(key: string): string {
  return key.split('/')[3] ?? '';
}

const _defaults: Record<string, string> = {};
const _entries: Record<string, Record<string, Record<string, AssetEntry>>> = {};

for (const [key, params] of Object.entries(_params)) {
  const name = familyFromKey(key);
  _defaults[name] = params.defaultVersion;
  _entries[name] = _assets[`./scripts/families/${name}/assets.json`] ?? {};
}

// ---- helpers ---------------------------------------------------------------

function _resolveVersion(family: string, version?: string): Record<string, AssetEntry> {
  const fam = _entries[family];
  if (!fam) {
    throw new Error(`Unknown vendor-assets family: ${family}. Known: ${Object.keys(_entries).join(', ')}.`);
  }
  const resolved = version ?? _defaults[family]!;
  const entry = fam[resolved];
  if (!entry) {
    throw new Error(
      `Unknown vendor-assets version: ${family}@${resolved}. Known: ${Object.keys(fam).join(', ')}.`,
    );
  }
  return entry;
}

// ---- public API ------------------------------------------------------------

export function listFamilies(): string[] {
  return Object.keys(_entries);
}

export function listAssets(family: string, version?: string): string[] {
  return Object.keys(_resolveVersion(family, version));
}

export function getAssetInfo(family: string, asset: string, version?: string): AssetEntry {
  const assets = _resolveVersion(family, version);
  const info = assets[asset];
  if (!info) {
    throw new Error(
      `Unknown vendor-assets asset: ${family}@${version ?? _defaults[family]!}/${asset}. Known: ${Object.keys(assets).join(', ')}.`,
    );
  }
  return info;
}

export function resolveAssetUrl(family: string, asset: string, version?: string): string {
  const info = getAssetInfo(family, asset, version);
  const v = version ?? _defaults[family]!;
  const key = `../vendor/${family}/${v}/${info.filename}`;
  const url = _urls[key];
  if (!url) {
    throw new Error(`No vendored file for ${family}/${asset} (expected ${key}). Run the ensure script.`);
  }
  return url;
}
