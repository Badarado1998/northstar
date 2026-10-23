import brand from '../../brand.json';
import { saveDownloadCatalog } from '../src/lib/downloads';
import { getDb } from '../src/lib/db';

const db = await getDb();
await saveDownloadCatalog(db, {
  macArm: brand.downloads.macArm ?? '',
  macIntel: brand.downloads.macIntel ?? '',
  windowsX64: brand.downloads.windowsX64 ?? '',
  windowsArm: brand.downloads.windowsArm ?? '',
  version: '0.3.28',
  releaseNotes: 'Northstar desktop 0.3.28 — install from app.bada.com.ng/download',
});
console.log('Synced desktop_downloads from brand.json to the database.');
