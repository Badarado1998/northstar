import { BRAND } from './brand';
import type { Db } from './db';

export type DownloadCatalog = {
  macArm: string;
  macIntel: string;
  windowsX64: string;
  windowsArm: string;
  version: string;
  releaseNotes: string;
};

const SLOT_KEYS = ['macArm', 'macIntel', 'windowsX64', 'windowsArm'] as const;

function normalizeUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function fromBrand(): DownloadCatalog {
  return {
    macArm: BRAND.downloads.macArm ?? '',
    macIntel: BRAND.downloads.macIntel ?? '',
    windowsX64: BRAND.downloads.windowsX64 ?? '',
    windowsArm: BRAND.downloads.windowsArm ?? '',
    version: '',
    releaseNotes: '',
  };
}

export async function getPublishedDownloads(db: Db): Promise<DownloadCatalog> {
  const merged = fromBrand();
  const rows = await db.query<{ value: Record<string, unknown> }>(`SELECT value FROM system_settings WHERE key = 'desktop_downloads'`);
  const stored = rows[0]?.value;
  if (!stored || typeof stored !== 'object') return merged;
  for (const key of SLOT_KEYS) {
    const override = normalizeUrl(stored[key]);
    if (override) merged[key] = override;
  }
  if (typeof stored.version === 'string') merged.version = stored.version.trim().slice(0, 40);
  if (typeof stored.releaseNotes === 'string') merged.releaseNotes = stored.releaseNotes.trim().slice(0, 4000);
  return merged;
}

export function parseDownloadInput(input: Record<string, unknown>): DownloadCatalog {
  return {
    macArm: normalizeUrl(input.macArm),
    macIntel: normalizeUrl(input.macIntel),
    windowsX64: normalizeUrl(input.windowsX64),
    windowsArm: normalizeUrl(input.windowsArm),
    version: typeof input.version === 'string' ? input.version.trim().slice(0, 40) : '',
    releaseNotes: typeof input.releaseNotes === 'string' ? input.releaseNotes.trim().slice(0, 4000) : '',
  };
}

export async function saveDownloadCatalog(db: Db, catalog: DownloadCatalog): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (key, value) VALUES ('desktop_downloads', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(catalog)],
  );
}

export function anyDownloadPublished(catalog: DownloadCatalog): boolean {
  return SLOT_KEYS.some(key => Boolean(catalog[key]));
}
