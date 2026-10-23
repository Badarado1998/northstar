'use client';
import { useEffect, useState } from 'react';

export default function DevicePage() {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setCode(new URLSearchParams(window.location.search).get('code') ?? ''); }, []);
  async function approve(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/auth/device/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userCode: code }) });
    const body = await response.json() as { error?: string };
    if (response.status === 401) { window.location.href = `/sign-in`; return; }
    setMessage(response.ok ? 'Desktop app approved. Return to the application.' : body.error ?? 'Could not approve that code.');
  }
  return <main className="px-6 py-12"><form onSubmit={approve} className="panel mx-auto grid max-w-md gap-3 p-6"><h1 className="font-serif text-4xl">Link desktop app</h1><label>Device code<input value={code} onChange={event => setCode(event.target.value)} required /></label><button className="button button-pine">Approve</button>{message ? <p className="text-sm">{message}</p> : null}</form></main>;
}
