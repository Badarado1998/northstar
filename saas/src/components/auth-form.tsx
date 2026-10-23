'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'verify' }) {
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);
  const [responseStatus, setResponseStatus] = useState(0);
  const [token, setToken] = useState('');
  useEffect(() => {
    if (mode === 'reset' || mode === 'verify') setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, [mode]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    setOk(false);
    setResponseStatus(0);
    const form = new FormData(event.currentTarget);
    const path = mode === 'sign-in' ? '/api/auth/login'
      : mode === 'sign-up' ? '/api/auth/register'
        : mode === 'forgot' ? '/api/auth/forgot'
          : mode === 'reset' ? '/api/auth/reset'
            : '/api/auth/verify';
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; devVerificationUrl?: string };
      setPending(false);
      if (!response.ok) {
        setResponseStatus(response.status);
        setMessage(body.error ?? `Request failed (${response.status}).`);
        return;
      }
      if (mode === 'sign-in') {
        window.location.href = '/account';
        return;
      }
      if (mode === 'sign-up') {
        if (body.devVerificationUrl) {
          setOk(true);
          setMessage(`Account created. Verify your email with this link: ${body.devVerificationUrl}`);
          return;
        }
        window.location.href = '/sign-in?registered=1';
        return;
      }
      setOk(true);
      setMessage(mode === 'forgot' ? 'If that email can receive mail, a reset link is on its way.' : 'Done.');
    } catch {
      setPending(false);
      setMessage('Network error. Check your connection and try again.');
    }
  }

  return <form onSubmit={submit} className="panel mx-auto grid max-w-md gap-3 p-6">
    <input type="hidden" name="mode" value={mode} />
    {mode !== 'reset' && mode !== 'verify' ? <label>Email<input name="email" type="email" required autoComplete="email" /></label> : null}
    {mode === 'sign-up' ? <label>Name<input name="name" autoComplete="name" /></label> : null}
    {mode === 'sign-in' || mode === 'sign-up' || mode === 'reset' ? <label>Password<input name="password" type="password" required minLength={10} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} /></label> : null}
    {mode === 'reset' || mode === 'verify' ? <label>Token<input name="token" required value={token} onChange={event => setToken(event.target.value)} /></label> : null}
    <button className="button button-pine" type="submit" disabled={pending}>{pending ? 'Working…' : 'Continue'}</button>
    {message ? <div role="alert" aria-live="polite" className="grid gap-2 text-sm">
      <p className={ok ? 'text-pine' : 'text-[#9b2c2c]'}>{message}</p>
      {!ok && mode === 'sign-up' && responseStatus === 409 ? <p className="text-ink/75">
        <Link className="underline text-pine" href="/sign-in">Go to sign in</Link>
        {' · '}
        <Link className="underline text-pine" href="/forgot-password">Forgot password</Link>
      </p> : null}
    </div> : null}
  </form>;
}
