'use client';

import { useEffect, useState } from 'react';

export function VerifyRequiredPanel() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(response => response.json() as Promise<{ signedIn?: boolean; email?: string; emailVerified?: boolean }>)
      .then(body => {
        if (!body.signedIn) { window.location.href = '/sign-in'; return; }
        if (body.emailVerified) { window.location.href = '/account'; return; }
        setEmail(body.email ?? '');
      })
      .catch(() => { window.location.href = '/sign-in'; });
  }, []);

  async function resend() {
    setPending(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/auth/resend-verification', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await response.json() as { error?: string; devVerificationUrl?: string };
      setPending(false);
      if (!response.ok) { setError(body.error ?? 'Could not send email.'); return; }
      if (body.devVerificationUrl) {
        setMessage(`Verification email is not configured yet. Use this link: ${body.devVerificationUrl}`);
        return;
      }
      setMessage('Verification email sent. Check your inbox and spam folder. The link expires in 24 hours.');
    } catch {
      setPending(false);
      setError('Network error. Try again.');
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
    window.location.href = '/';
  }

  return <div className="panel mx-auto max-w-md space-y-4 p-6 shadow-sm">
    {email ? <p className="text-sm text-ink/70">Signed in as <strong>{email}</strong></p> : <p className="text-sm text-ink/70">Loading…</p>}
    <p className="text-sm leading-6 text-ink/80">For security, billing, the desktop app, and platform models stay locked until you confirm this email address.</p>
    <button className="button button-pine w-full" type="button" disabled={pending} onClick={resend}>{pending ? 'Sending…' : 'Resend verification email'}</button>
    <button className="button button-line w-full" type="button" onClick={signOut}>Sign out</button>
    {message ? <p role="status" className="rounded-[12px] border border-pine/30 bg-pine/10 px-3 py-3 text-sm text-pine">{message}</p> : null}
    {error ? <p role="alert" className="rounded-[12px] border border-[#9b2c2c]/30 bg-[#9b2c2c]/10 px-3 py-3 text-sm text-[#9b2c2c]">{error}</p> : null}
  </div>;
}
