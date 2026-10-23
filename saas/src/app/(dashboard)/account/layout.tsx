import { webPrincipal } from '@/lib/session-server';
import { redirect } from 'next/navigation';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const principal = await webPrincipal();
  if (!principal) redirect('/sign-in');
  if (!principal.emailVerified) redirect('/verify-required');
  return children;
}
