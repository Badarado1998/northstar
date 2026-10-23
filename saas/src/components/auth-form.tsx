'use client';
import { useActionState, useEffect, useState } from 'react';
import { submitAuth, type AuthState } from '@/lib/auth-actions';

const empty: AuthState = {};

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'verify' }) {
  const [state, action, pending] = useActionState(submitAuth, empty);
  const [token, setToken] = useState('');
  useEffect(() => {
    if (mode === 'reset' || mode === 'verify') setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, [mode]);
  const notice = state.error ?? state.message ?? '';
  return <form action={action} className="panel mx-auto grid max-w-md gap-3 p-6">
    <input type="hidden" name="mode" value={mode} />
    {mode !== 'reset' && mode !== 'verify' ? <label>Email<input name="email" type="email" required autoComplete="email" /></label> : null}
    {mode === 'sign-up' ? <label>Name<input name="name" autoComplete="name" /></label> : null}
    {mode === 'sign-in' || mode === 'sign-up' || mode === 'reset' ? <label>Password<input name="password" type="password" required minLength={10} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} /></label> : null}
    {mode === 'reset' || mode === 'verify' ? <label>Token<input name="token" required value={token} onChange={event => setToken(event.target.value)} /></label> : null}
    <button className="button button-pine" type="submit" disabled={pending}>{pending ? 'Working…' : 'Continue'}</button>
    {notice ? <p className="text-sm">{notice}</p> : null}
  </form>;
}
