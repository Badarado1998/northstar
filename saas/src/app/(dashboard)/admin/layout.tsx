import { isPlatformAdmin } from '@/lib/admin';
import { getDb } from '@/lib/db';
import { webPrincipal } from '@/lib/session-server';
import { redirect } from 'next/navigation';

export default async function AdminRouteLayout({ children }: { children: React.ReactNode }) {
  const principal = await webPrincipal();
  if (!principal) redirect('/sign-in');
  if (!principal.emailVerified) redirect('/verify-required');
  const db = await getDb();
  if (!await isPlatformAdmin(db, principal.userId)) redirect('/account');
  return children;
}
