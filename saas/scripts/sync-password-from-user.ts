/**
 * Copy password_hash from one user to others (same login password, no plaintext).
 * Usage: node --env-file=.env --import tsx scripts/sync-password-from-user.ts <sourceEmail> <targetEmail> [moreTargets...]
 */
import { getDb } from '../src/lib/db';

const source = process.argv[2]?.trim().toLowerCase();
const targets = process.argv.slice(3).map(e => e.trim().toLowerCase()).filter(Boolean);

if (!source || !targets.length) {
  console.error('Usage: sync-password-from-user.ts <sourceEmail> <targetEmail> [...]');
  process.exit(1);
}

const db = await getDb();
const rows = await db.query<{ id: string; password_hash: string | null }>(
  `SELECT id::text, password_hash FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`,
  [source],
);
const sourceUser = rows[0];
if (!sourceUser?.password_hash) {
  console.error(`Source ${source} has no password hash (missing user or OAuth-only).`);
  process.exit(1);
}

for (const email of targets) {
  if (email === source) continue;
  const updated = await db.query<{ id: string }>(
    `UPDATE users SET password_hash = $2, updated_at = now()
     WHERE lower(email) = $1 AND deleted_at IS NULL
     RETURNING id::text`,
    [email, sourceUser.password_hash],
  );
  if (!updated.length) console.error(`No user updated for ${email}`);
  else console.log(`Password hash synced: ${email} ← ${source}`);
}
