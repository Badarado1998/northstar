'use client';
import { useEffect, useState } from 'react';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'verify' }) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState('');
  useEffect(() => {
    if (mode === 'reset' || mode === 'verify') setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, [mode]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const path = mode === 'sign-in' ? '/api/auth/login' : mode === 'sign-up' ? '/api/auth/register' : mode === 'forgot' ? '/api/auth/forgot' : mode === 'reset' ? '/api/auth/reset' : '/api/auth/verify';
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) });
    const body = await response.json() as { error?: string; devVerificationUrl?: string };
    setPending(false);
    if (!response.ok) { setMessage(body.error ?? 'Request failed.'); return; }
    if (mode === 'sign-in') { window.location.href = '/account'; return; }
    if (mode === 'sign-up') setMessage(body.devVerificationUrl ? `Account created. Development verification link: ${body.devVerificationUrl}` : 'Account created. Check your email to verify it.');
    else setMessage('Done.');
  }
  return <form onSubmit={submit} className="panel mx-auto grid max-w-md gap-3 p-6">
    {mode !== 'reset' && mode !== 'verify' ? <label>Email<input name="email" type="email" required autoComplete="email" /></label> : null}
    {mode === 'sign-up' ? <label>Name<input name="name" autoComplete="name" /></label> : null}
    {mode === 'sign-in' || mode === 'sign-up' || mode === 'reset' ? <label>Password<input name="password" type="password" required minLength={10} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} /></label> : null}
    {mode === 'reset' || mode === 'verify' ? <label>Token<input name="token" required value={token} onChange={event => setToken(event.target.value)} /></label> : null}
    <button className="button button-pine" disabled={pending}>{pending ? 'Working…' : 'Continue'}</button>
    {message ? <p className="text-sm">{message}</p> : null}
  </form>;
}
