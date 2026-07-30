/**
 * Vendored asset registry — narrow lookup surface over every family's
 * assets.json and every file under `vendor/`.
 */

/** A single declared asset, enriched with its registry lookup keys at runtime. */
export interface AssetEntry {
  /** Family this asset belongs to (e.g. 'als-wasm'). */
  family: string;
  /** Version key within the family (e.g. 'v6'). */
  version: string;
  /** Asset name within the version (e.g. 'opt'). */
  asset: string;
  /** On-disk filename under `vendor/<family>/<version>/`. */
  filename: string;
  /** Hex SHA-256 anchor (absent for non-reproducible assets). */
  sha256?: string;
  /** Recorded size in bytes (absent for non-reproducible assets). */
  sizeBytes?: number;
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
    throw new Error(
      `No vendored file for ${family}/${asset} (expected ${key}). Run the ensure script.`,
    );
  }
  return url;
}

/** Resolve the absolute filesystem path of a vendored asset (Node.js only). */
export function resolveAssetPath(family: string, asset: string, version?: string): string {
  const info = getAssetInfo(family, asset, version);
  const v = version ?? _defaults[family]!;
  return new URL(`../vendor/${family}/${v}/${info.filename}`, import.meta.url).pathname;
}

// ---- internal --------------------------------------------------------------

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

function familyFromKey(key: string): string {
  return key.split('/')[3] ?? '';
}

const _defaults: Record<string, string> = {};
const _entries: Record<string, Record<string, Record<string, AssetEntry>>> = {};

for (const [key, params] of Object.entries(_params)) {
  const name = familyFromKey(key);
  _defaults[name] = params.defaultVersion;
  const versions = _assets[`./scripts/families/${name}/assets.json`] ?? {};
  for (const [version, assets] of Object.entries(versions)) {
    for (const [asset, entry] of Object.entries(assets)) {
      entry.family = name;
      entry.version = version;
      entry.asset = asset;
    }
  }
  _entries[name] = versions;
}

function _resolveVersion(family: string, version?: string): Record<string, AssetEntry> {
  const fam = _entries[family];
  if (!fam) {
    throw new Error(
      `Unknown vendor-assets family: ${family}. Known: ${Object.keys(_entries).join(', ')}.`,
    );
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
