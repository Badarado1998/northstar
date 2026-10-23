'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Session = { signedIn: boolean; email?: string; emailVerified?: boolean };

export function AuthNav() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(response => response.json() as Promise<Session>)
      .then(setSession)
      .catch(() => setSession({ signedIn: false }));
  }, []);

  if (session === null) {
    return <div className="flex min-w-[9rem] justify-end gap-2 text-sm opacity-60"><span className="button button-line pointer-events-none">…</span></div>;
  }

  if (!session.signedIn) {
    return <div className="flex flex-wrap justify-end gap-2 text-sm">
      <Link className="button button-line" href="/sign-in">Sign in</Link>
      <Link className="button button-dark" href="/sign-up">Create account</Link>
    </div>;
  }

  const accountHref = session.emailVerified ? '/account' : '/verify-required';
  return <div className="flex max-w-[14rem] flex-col items-end gap-1 sm:max-w-none sm:flex-row sm:items-center sm:gap-2">
    <Link className="truncate text-xs text-ink/60 no-underline hover:text-pine sm:max-w-[10rem] sm:text-sm" href={accountHref} title={session.email}>{session.email}</Link>
    <Link className="button button-line shrink-0 px-3 py-2 text-xs sm:text-sm" href={accountHref}>{session.emailVerified ? 'Account' : 'Verify email'}</Link>
  </div>;
}
