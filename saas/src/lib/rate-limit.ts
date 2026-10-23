import type { Db } from './db';

/** Returns true when the caller is inside the limit. */
export async function allowRate(db: Db, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  if (!Number.isInteger(limit) || !Number.isInteger(windowSeconds) || limit < 1 || windowSeconds < 1) {
    throw new Error('Rate limit window is invalid.');
  }
  const rows = await db.query<{ count: number }>(`INSERT INTO rate_limits (bucket, window_start, count)
    VALUES ($1, now(), 1)
    ON CONFLICT (bucket) DO UPDATE SET
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::int) THEN now() ELSE rate_limits.window_start END,
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::int) THEN 1 ELSE rate_limits.count + 1 END
    RETURNING count`, [bucket.slice(0, 200), windowSeconds]);
  return Number(rows[0].count) <= limit;
}
