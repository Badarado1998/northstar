import { PGlite } from '@electric-sql/pglite';
import { migrate, type Db } from '../src/lib/db';

interface Queryable { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }

function adapter(root: PGlite, runner: Queryable, nested: boolean): Db {
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await runner.query(text, params);
      return result.rows as T[];
    },
    async transaction(fn) {
      if (nested) return fn(adapter(root, runner, true));
      return await root.transaction(async tx => fn(adapter(root, tx, true)));
    },
  };
}

export async function testDb(): Promise<Db> {
  const client = new PGlite();
  const db = adapter(client, client, false);
  await migrate(db);
  return db;
}
