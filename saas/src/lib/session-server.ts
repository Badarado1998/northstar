import { cookies } from 'next/headers';
import { principalFromWebToken, type Principal } from './auth';
import { getDb } from './db';

export async function webPrincipal(): Promise<Principal | null> {
  const jar = await cookies();
  const token = jar.get('ns_session')?.value;
  if (!token) return null;
  const db = await getDb();
  return principalFromWebToken(db, token);
}
