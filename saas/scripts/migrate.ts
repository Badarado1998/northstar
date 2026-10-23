import { getDb } from '../src/lib/db';

await getDb();
console.log('Schema applied.');
