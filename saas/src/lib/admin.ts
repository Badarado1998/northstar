import type { Db } from './db';

export async function isPlatformAdmin(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query(`SELECT 1 FROM platform_admins WHERE user_id = $1`, [userId]);
  return rows.length > 0;
}
