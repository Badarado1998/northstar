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

  async function removeAccount() {
    if (!window.confirm('Delete this account? Sessions are revoked and the email is replaced. Billing history stays for the ledger.')) return;
    await api('/api/account', { method: 'DELETE' });
    window.location.href = '/';
  }

  if (!account) {
    return <div className="d-flex justify-content-center py-5"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">{error || 'Loading…'}</span></div></div>;
  }

  const allowance = account.plan?.allowanceLabel ?? '$0.00';
  const planTitle = account.plan?.name ?? 'No plan';

  return <>
    <div className="app-content-header">
      <div className="container-fluid">
        <div className="row mb-2">
          <div className="col-sm-6"><h3 className="mb-0">{planTitle}</h3></div>
          <div className="col-sm-6">
            <ol className="breadcrumb float-sm-end mb-0">
              <li className="breadcrumb-item"><a href="/account">Account</a></li>
              <li className="breadcrumb-item active" aria-current="page">Overview</li>
            </ol>
          </div>
        </div>
        <p className="text-body-secondary mb-0">{account.email}</p>
      </div>
    </div>

    {account.lowCredit ? <div className="alert alert-warning">Included platform credits are low. Hosted model calls stop at zero. Purchased credits are separate.</div> : null}
    {error ? <div className="alert alert-danger">{error}</div> : null}
    {message ? <div className="alert alert-success">{message}</div> : null}

    <div className="row">
      <div className="col-lg-4 col-12">
        <div className="small-box text-bg-primary">
          <div className="inner"><h3>{account.credits.includedLabel}</h3><p>Included remaining</p></div>
          <div className="small-box-footer">of {allowance} this period</div>
        </div>
      </div>
      <div className="col-lg-4 col-12">
        <div className="small-box text-bg-success">
          <div className="inner"><h3>{account.credits.topupLabel}</h3><p>Purchased credits</p></div>
          <div className="small-box-footer">Held for later periods</div>
        </div>
      </div>
      <div className="col-lg-4 col-12">
        <div className="small-box text-bg-info">
          <div className="inner"><h3>{account.credits.reservedLabel}</h3><p>Reserved</p></div>
          <div className="small-box-footer">{account.devices.active} of {account.devices.allowance} devices</div>
        </div>
      </div>
    </div>

    <div className="card mb-4">
      <div className="card-header"><h3 className="card-title">Plans</h3></div>
      <div className="card-body">
        <p className="text-body-secondary mb-3">
          Status: {account.plan?.status ?? 'none'}
          {account.plan?.periodEnd ? ` · renews or ends ${account.plan.periodEnd.slice(0, 10)}` : ''}
          {account.plan?.cancelAtPeriodEnd ? ' · cancellation scheduled' : ''}
        </p>
        <div className="d-flex flex-wrap gap-2">
          {plans.filter(plan => plan.self_serve && plan.id !== 'free').map(plan => (
            <button key={plan.id} type="button" className="btn btn-primary" onClick={() => checkout('subscription', plan.id)}>
              {plan.name} · {plan.priceLabel} · {plan.allowanceLabel}
            </button>
          ))}
          {account.plan && account.plan.id !== 'free' ? <button type="button" className="btn btn-outline-secondary" onClick={() => checkout('renewal', account.plan?.id)}>Renew current plan</button> : null}
          {account.plan && account.plan.id !== 'free' && !account.plan.cancelAtPeriodEnd ? <button type="button" className="btn btn-outline-danger" onClick={cancel}>Cancel at period end</button> : null}
        </div>
      </div>
    </div>

    {account.plan?.allowTopups ? (
      <div className="card mb-4">
        <div className="card-header"><h3 className="card-title">Buy credits</h3></div>
        <div className="card-body d-flex flex-wrap gap-2">
          {packages.map(pack => <button key={pack.id} type="button" className="btn btn-dark" onClick={() => checkout('topup', undefined, pack.id)}>{pack.name} · {pack.priceLabel}</button>)}
        </div>
      </div>
    ) : null}

    <div className="card mb-4">
      <div className="card-header"><h3 className="card-title">Usage by model</h3></div>
      <div className="card-body">
        <ul className="list-unstyled mb-4">
          {account.byModel.length ? account.byModel.map(row => <li key={row.model_id}>{row.model_id}: {row.requests} requests, billed micros {row.billed_micros}</li>) : <li className="text-body-secondary">No platform-model usage yet.</li>}
        </ul>
        <h4 className="h5">Recent requests</h4>
        <ul className="list-unstyled mb-0">
          {account.usage.length ? account.usage.map(row => <li key={row.id} className="small">{row.created_at.slice(0, 16)} · {row.model_id} · {row.status} · {row.input_tokens}/{row.output_tokens} tokens · {row.billed_micros} micros</li>) : <li className="text-body-secondary">No requests recorded.</li>}
        </ul>
      </div>
    </div>

    <div className="card mb-4">
      <div className="card-header"><h3 className="card-title">Devices</h3></div>
      <div className="card-body p-0">
        <ul className="list-group list-group-flush">
          {devices.map(device => (
            <li key={device.id} className="list-group-item d-flex justify-content-between align-items-center gap-3">
              <span>{device.name} · {device.platform} · {device.revoked_at ? 'revoked' : 'active'}</span>
              {device.revoked_at ? null : <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => revoke(device.id)}>Revoke</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>

    <div className="card border-danger mb-4">
      <div className="card-header"><h3 className="card-title">Delete account</h3></div>
      <div className="card-body">
        <p className="text-body-secondary">This revokes sessions and replaces the email. It does not erase the credit ledger.</p>
        <button type="button" className="btn btn-outline-danger" onClick={removeAccount}>Delete account</button>
      </div>
    </div>
  </>;
}
