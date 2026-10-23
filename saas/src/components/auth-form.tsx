'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'verify';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium text-ink/80">{label}{children}</label>;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);
  const [responseStatus, setResponseStatus] = useState(0);
  const [token, setToken] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get('token') ?? '';
    if (mode === 'reset' || mode === 'verify') setToken(queryToken);
    if (mode === 'verify' && queryToken) void runVerify(queryToken);
  }, [mode]);

  async function runVerify(verifyToken: string) {
    setPending(true);
    setMessage('');
    setOk(false);
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: verifyToken }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      setPending(false);
      if (!response.ok) {
        setMessage(body.error ?? 'We could not verify this link.');
        return;
      }
      window.location.href = '/sign-in?verified=1';
    } catch {
      setPending(false);
      setMessage('Network error. Try opening the link again or paste the token below.');
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setOk(false);
    setResponseStatus(0);

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if ((mode === 'sign-up' || mode === 'reset') && password !== confirmPassword) {
      setMessage('Passwords do not match. Type the same password in both fields.');
      return;
    }
    if (mode === 'reset' && !token.trim()) {
      setMessage('This reset link is missing or incomplete. Request a new one from the forgot password page.');
      return;
    }

    setPending(true);
    const path = mode === 'sign-in' ? '/api/auth/login'
      : mode === 'sign-up' ? '/api/auth/register'
        : mode === 'forgot' ? '/api/auth/forgot'
          : mode === 'reset' ? '/api/auth/reset'
            : '/api/auth/verify';
    const payload = Object.fromEntries(form);
    if (mode === 'reset' || mode === 'verify') payload.token = token;

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; devVerificationUrl?: string; devResetUrl?: string };
      setPending(false);
      if (!response.ok) {
        setResponseStatus(response.status);
        setMessage(body.error ?? `Something went wrong (${response.status}).`);
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
      if (mode === 'forgot') {
        setOk(true);
        if (body.devResetUrl) {
          setMessage(`If that email is registered, we sent a reset link. For now, use this link: ${body.devResetUrl}`);
          return;
        }
        setMessage('If an account exists for that email, we sent a password reset link. Check your inbox and spam folder. The link expires in 30 minutes.');
        return;
      }
      if (mode === 'reset') {
        window.location.href = '/sign-in?reset=1';
        return;
      }
      if (mode === 'verify') {
        window.location.href = '/sign-in?verified=1';
      }
    } catch {
      setPending(false);
      setMessage('Network error. Check your connection and try again.');
    }
  }

  if (mode === 'verify' && token && pending && !message) {
    return <div className="panel mx-auto max-w-md p-8 text-center text-sm text-ink/70">Verifying your email…</div>;
  }

  return <form onSubmit={submit} className="panel mx-auto grid max-w-md gap-4 p-6 shadow-sm">
    {mode !== 'reset' && mode !== 'verify' ? (
      <Field label="Email address"><input name="email" type="email" required autoComplete="email" placeholder="you@company.com" /></Field>
    ) : null}
    {mode === 'sign-up' ? (
      <Field label="Full name"><input name="name" type="text" autoComplete="name" placeholder="Your name" /></Field>
    ) : null}
    {mode === 'sign-in' || mode === 'sign-up' || mode === 'reset' ? (
      <>
        <Field label={mode === 'reset' ? 'New password' : 'Password'}>
          <input name="password" type="password" required minLength={10} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} placeholder="At least 10 characters" />
        </Field>
        {mode === 'sign-up' || mode === 'reset' ? (
          <Field label="Confirm password">
            <input name="confirmPassword" type="password" required minLength={10} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Repeat your password" />
          </Field>
        ) : null}
      </>
    ) : null}
    {mode === 'verify' && !token ? (
      <Field label="Verification code from your email">
        <input name="token" required value={token} onChange={event => setToken(event.target.value)} placeholder="Paste the token from the email link" />
      </Field>
    ) : null}
    {mode === 'reset' && !token ? (
      <Field label="Reset code from your email">
        <input name="token" required value={token} onChange={event => setToken(event.target.value)} placeholder="Paste the token from the reset link" />
      </Field>
    ) : null}
    <button className="button button-pine w-full" type="submit" disabled={pending}>{pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Verify email'}</button>
    {message ? <div role="alert" aria-live="polite" className="grid gap-2 rounded-[12px] border px-3 py-3 text-sm" style={{ borderColor: ok ? 'rgb(31 111 84 / 0.35)' : 'rgb(155 44 44 / 0.35)', background: ok ? 'rgb(31 111 84 / 0.08)' : 'rgb(155 44 44 / 0.06)' }}>
      <p className={ok ? 'text-pine' : 'text-[#9b2c2c]'}>{message}</p>
      {!ok && mode === 'sign-up' && responseStatus === 409 ? <p className="text-ink/75">
        <Link className="font-medium underline text-pine" href="/sign-in">Sign in</Link>
        {' · '}
        <Link className="font-medium underline text-pine" href="/forgot-password">Forgot password</Link>
      </p> : null}
    </div> : null}
    {mode === 'sign-in' ? <p className="text-center text-sm"><Link className="text-pine underline" href="/forgot-password">Forgot your password?</Link></p> : null}
  </form>;
}
