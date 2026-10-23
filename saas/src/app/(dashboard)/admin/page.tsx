'use client';
import { useEffect, useState } from 'react';

export default function AdminPage() {
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [users, setUsers] = useState<Array<Record<string, string>>>([]);
  const [plans, setPlans] = useState<Array<Record<string, string>>>([]);
  const [providers, setProviders] = useState<Array<Record<string, unknown>>>([]);
  const [finance, setFinance] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('');

  async function load(path: string) {
    const response = await fetch(path);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Unavailable');
    return body;
  }

  useEffect(() => {
    Promise.all([load('/api/admin/overview'), load('/api/admin/users'), load('/api/admin/plans'), load('/api/admin/providers'), load('/api/admin/finance')])
      .then(([nextOverview, nextUsers, nextPlans, nextProviders, nextFinance]) => {
        setOverview(nextOverview);
        setUsers(nextUsers.users ?? []);
        setPlans(nextPlans.plans ?? []);
        setProviders(nextProviders.providers ?? []);
        setFinance(nextFinance);
      })
      .catch(cause => setMessage(cause instanceof Error ? cause.message : 'Admin data unavailable.'));
  }, []);

  async function bootstrap() {
    const response = await fetch('/api/admin/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await response.json() as { error?: string };
    setMessage(response.ok ? 'Administrator created.' : body.error ?? 'Bootstrap failed.');
  }

  return <main className="mx-auto max-w-5xl px-6 py-12">
    <h1 className="font-serif text-5xl">Admin</h1>
    <p className="mt-2 text-sm text-ink/70">Figures below are queried from the ledger and payment tables. Sign in as the configured first administrator, then bootstrap once.</p>
    <button className="button button-line mt-4" onClick={bootstrap}>Become first administrator</button>
    {message ? <p className="mt-3 text-sm">{message}</p> : null}
    <section className="panel mt-6 p-5"><h2 className="font-serif text-2xl">Overview</h2><pre className="mt-3 overflow-auto text-xs">{overview ? JSON.stringify(overview, null, 2) : 'No overview loaded.'}</pre></section>
    <section className="panel mt-4 p-5"><h2 className="font-serif text-2xl">Users</h2><ul className="mt-3 text-sm">{users.map(user => <li key={user.id}>{user.email} · {user.status} · {user.plan_id ?? 'no plan'}</li>)}</ul></section>
    <section className="panel mt-4 p-5"><h2 className="font-serif text-2xl">Plans</h2><ul className="mt-3 text-sm">{plans.map(plan => <li key={plan.id}>{plan.name} · {plan.currency} {plan.price_subunits} subunits · allowance {plan.included_allowance_micros} micros · devices {plan.max_devices}</li>)}</ul></section>
    <section className="panel mt-4 p-5"><h2 className="font-serif text-2xl">Providers</h2><ul className="mt-3 text-sm">{providers.map(provider => <li key={String(provider.id)}>{String(provider.name)} · {provider.enabled ? 'enabled' : 'disabled'} · secret {provider.secretConfigured ? 'configured' : 'missing'}</li>)}</ul></section>
    <section className="panel mt-4 p-5"><h2 className="font-serif text-2xl">Finance</h2><pre className="mt-3 overflow-auto text-xs">{finance ? JSON.stringify(finance, null, 2) : 'No finance loaded.'}</pre></section>
  </main>;
}
