'use client';

import { useEffect, useState } from 'react';

type UsageRow = { id: string; model_id: string; status: string; created_at: string; billed_micros: string; input_tokens: string; output_tokens: string };
type ModelRow = { model_id: string; billed_micros: string; requests: string };
type Device = { id: string; name: string; platform: string; app_version: string; last_seen_at: string; revoked_at: string | null };
type Plan = { id: string; name: string; priceLabel: string; allowanceLabel: string; self_serve: boolean };
type Pack = { id: string; name: string; priceLabel: string; creditLabel: string };
type Snapshot = {
  email: string;
  name: string;
  emailVerified: boolean;
  plan: { id: string; name: string; status: string; cancelAtPeriodEnd: boolean; periodEnd: string | null; allowanceLabel: string; maxDevices: number; allowTopups: boolean; allowByok: boolean } | null;
  credits: { includedLabel: string; topupLabel: string; reservedLabel: string };
  lowCredit: boolean;
  devices: { active: number; allowance: number };
  usage: UsageRow[];
  byModel: ModelRow[];
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json() as { error?: string; authorizationUrl?: string; note?: string };
  if (response.status === 401) { window.location.href = '/sign-in'; throw new Error('Sign in required.'); }
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body;
}

export function AccountPanel() {
  const [account, setAccount] = useState<Snapshot | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packages, setPackages] = useState<Pack[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [summary, deviceList, catalog] = await Promise.all([
      fetch('/api/account').then(async response => {
        if (response.status === 401) { window.location.href = '/sign-in'; return null; }
        if (response.status === 403) { window.location.href = '/verify-required'; return null; }
        return response.json() as Promise<Snapshot & { error?: string }>;
      }),
      fetch('/api/account/devices').then(response => response.ok ? response.json() as Promise<{ devices: Device[] }> : { devices: [] }),
      fetch('/api/billing/plans').then(response => response.ok ? response.json() as Promise<{ plans: Plan[]; packages: Pack[] }> : { plans: [], packages: [] }),
    ]);
    if (!summary || 'error' in summary && summary.error && !summary.email) { setError(summary?.error ?? 'Account unavailable.'); return; }
    setAccount(summary);
    setDevices(deviceList.devices);
    setPlans(catalog.plans);
    setPackages(catalog.packages);
  }

  useEffect(() => { load().catch(cause => setError(cause instanceof Error ? cause.message : 'Account unavailable.')); }, []);

  async function checkout(purpose: 'subscription' | 'renewal' | 'topup', planId?: string, packageId?: string) {
    setError('');
    setMessage('');
    try {
      const result = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ purpose, planId, packageId }) });
      if (result.authorizationUrl) window.location.href = result.authorizationUrl;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Checkout failed.'); }
  }

  async function cancel() {
    setError('');
    try {
      const result = await api('/api/billing/cancel', { method: 'POST', body: '{}' });
      setMessage(result.note ?? 'Cancellation recorded.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cancellation failed.'); }
  }

  async function revoke(deviceId: string) {
    await api('/api/account/devices/revoke', { method: 'POST', body: JSON.stringify({ deviceId }) });
    await load();
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    window.location.href = '/';
  }

  async function removeAccount() {
    if (!window.confirm('Delete this account? Sessions are revoked and the email is replaced. Billing history stays for the ledger.')) return;
    await api('/api/account', { method: 'DELETE' });
    window.location.href = '/';
  }

  if (!account) return <main className="mx-auto max-w-4xl px-6 py-12"><p>{error || 'Loading account…'}</p></main>;
  const allowance = account.plan?.allowanceLabel ?? '$0.00';
  return <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm text-ink/60">{account.email}</p><h1 className="font-serif text-4xl sm:text-5xl">{account.plan?.name ?? 'No plan'}</h1></div>
      <button className="button button-line w-full sm:w-auto" onClick={signOut}>Sign out</button>
    </div>
    {account.lowCredit ? <p className="panel border-copper p-4 text-sm">Included platform credits are low. Hosted model calls stop at zero. Purchased credits are separate.</p> : null}
    {error ? <p className="text-sm text-copper">{error}</p> : null}
    {message ? <p className="text-sm">{message}</p> : null}
    <section className="grid gap-4 md:grid-cols-3">
      <article className="panel p-5"><p className="text-sm text-ink/60">Included remaining</p><p className="font-serif text-3xl">{account.credits.includedLabel}</p><p className="mt-1 text-sm">of {allowance} this period</p></article>
      <article className="panel p-5"><p className="text-sm text-ink/60">Purchased credits</p><p className="font-serif text-3xl">{account.credits.topupLabel}</p><p className="mt-1 text-sm">Held for later periods</p></article>
      <article className="panel p-5"><p className="text-sm text-ink/60">Reserved</p><p className="font-serif text-3xl">{account.credits.reservedLabel}</p><p className="mt-1 text-sm">{account.devices.active} of {account.devices.allowance} devices</p></article>
    </section>
    <section className="panel p-5">
      <h2 className="font-serif text-2xl">Plans</h2>
      <p className="mt-1 text-sm text-ink/70">Status: {account.plan?.status ?? 'none'}{account.plan?.periodEnd ? ` · renews or ends ${account.plan.periodEnd.slice(0, 10)}` : ''}{account.plan?.cancelAtPeriodEnd ? ' · cancellation scheduled' : ''}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {plans.filter(plan => plan.self_serve && plan.id !== 'free').map(plan => <button key={plan.id} className="button button-pine w-full justify-center text-left sm:w-auto" onClick={() => checkout('subscription', plan.id)}>{plan.name} · {plan.priceLabel} · {plan.allowanceLabel}</button>)}
        {account.plan && account.plan.id !== 'free' ? <button className="button button-line" onClick={() => checkout('renewal', account.plan?.id)}>Renew current plan</button> : null}
        {account.plan && account.plan.id !== 'free' && !account.plan.cancelAtPeriodEnd ? <button className="button button-line" onClick={cancel}>Cancel at period end</button> : null}
      </div>
    </section>
    {account.plan?.allowTopups ? <section className="panel p-5"><h2 className="font-serif text-2xl">Buy credits</h2><div className="mt-4 flex flex-wrap gap-2">{packages.map(pack => <button key={pack.id} className="button button-dark" onClick={() => checkout('topup', undefined, pack.id)}>{pack.name} · {pack.priceLabel}</button>)}</div></section> : null}
    <section className="panel p-5">
      <h2 className="font-serif text-2xl">Usage by model</h2>
      <ul className="mt-3 text-sm">{account.byModel.length ? account.byModel.map(row => <li key={row.model_id}>{row.model_id}: {row.requests} requests, billed micros {row.billed_micros}</li>) : <li>No platform-model usage yet.</li>}</ul>
      <h3 className="mt-5 font-serif text-xl">Recent requests</h3>
      <ul className="mt-2 text-sm">{account.usage.length ? account.usage.map(row => <li key={row.id}>{row.created_at.slice(0, 16)} · {row.model_id} · {row.status} · {row.input_tokens}/{row.output_tokens} tokens · {row.billed_micros} micros</li>) : <li>No requests recorded.</li>}</ul>
    </section>
    <section className="panel p-5">
      <h2 className="font-serif text-2xl">Devices</h2>
      <ul className="mt-3 grid gap-2 text-sm">{devices.map(device => <li key={device.id} className="flex items-center justify-between gap-3"><span>{device.name} · {device.platform} · {device.revoked_at ? 'revoked' : 'active'}</span>{device.revoked_at ? null : <button className="button button-line" onClick={() => revoke(device.id)}>Revoke</button>}</li>)}</ul>
    </section>
    <section className="panel p-5"><h2 className="font-serif text-2xl">Delete account</h2><p className="mt-2 text-sm">This revokes sessions and replaces the email. It does not erase the credit ledger.</p><button className="button button-line mt-3" onClick={removeAccount}>Delete account</button></section>
  </main>;
}
