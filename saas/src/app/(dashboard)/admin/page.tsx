'use client';

import { AdminDownloadsPanel } from '@/components/admin-downloads-panel';
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
    Promise.all([
      load('/api/admin/overview'),
      load('/api/admin/users'),
      load('/api/admin/plans'),
      load('/api/admin/providers'),
      load('/api/admin/finance'),
    ])
      .then(([nextOverview, nextUsers, nextPlans, nextProviders, nextFinance]) => {
        setOverview(nextOverview);
        setUsers(nextUsers.users ?? []);
        setPlans(nextPlans.plans ?? []);
        setProviders(nextProviders.providers ?? []);
        setFinance(nextFinance);
      })
      .catch(cause => setMessage(cause instanceof Error ? cause.message : 'Admin data unavailable.'));
  }, []);

  return <>
    <div className="app-content-header">
      <div className="container-fluid">
        <div className="row mb-2">
          <div className="col-sm-6"><h3 className="mb-0">Admin</h3></div>
          <div className="col-sm-6">
            <ol className="breadcrumb float-sm-end mb-0">
              <li className="breadcrumb-item"><a href="/account">Account</a></li>
              <li className="breadcrumb-item active" aria-current="page">Admin</li>
            </ol>
          </div>
        </div>
        <p className="text-body-secondary mb-0">Ledger, users, plans, and provider configuration.</p>
      </div>
    </div>

    {message ? <div className="alert alert-danger">{message}</div> : null}

    <AdminDownloadsPanel />

    <div className="card mb-4">
      <div className="card-header"><h3 className="card-title">Overview</h3></div>
      <div className="card-body"><pre className="mb-0 overflow-auto small">{overview ? JSON.stringify(overview, null, 2) : 'Loading…'}</pre></div>
    </div>

    <div className="card mb-4">
      <div className="card-header"><h3 className="card-title">Users</h3></div>
      <div className="card-body p-0">
        <ul className="list-group list-group-flush">
          {users.length ? users.map(user => (
            <li key={user.id} className="list-group-item small">{user.email} · {user.status} · {user.plan_id ?? 'no plan'}</li>
          )) : <li className="list-group-item text-body-secondary">No users loaded.</li>}
        </ul>
      </div>
    </div>

    <div className="card mb-4">
      <div className="card-header"><h3 className="card-title">Plans</h3></div>
      <div className="card-body p-0">
        <ul className="list-group list-group-flush">
          {plans.length ? plans.map(plan => (
            <li key={plan.id} className="list-group-item small">{plan.name} · {plan.currency} {plan.price_subunits} subunits · allowance {plan.included_allowance_micros} micros · devices {plan.max_devices}</li>
          )) : <li className="list-group-item text-body-secondary">No plans loaded.</li>}
        </ul>
      </div>
    </div>

    <div className="card mb-4">
      <div className="card-header"><h3 className="card-title">Providers</h3></div>
      <div className="card-body p-0">
        <ul className="list-group list-group-flush">
          {providers.length ? providers.map(provider => (
            <li key={String(provider.id)} className="list-group-item small">{String(provider.name)} · {provider.enabled ? 'enabled' : 'disabled'} · secret {provider.secretConfigured ? 'configured' : 'missing'}</li>
          )) : <li className="list-group-item text-body-secondary">No providers loaded.</li>}
        </ul>
      </div>
    </div>

    <div className="card mb-4">
      <div className="card-header"><h3 className="card-title">Finance</h3></div>
      <div className="card-body"><pre className="mb-0 overflow-auto small">{finance ? JSON.stringify(finance, null, 2) : 'Loading…'}</pre></div>
    </div>
  </>;
}
