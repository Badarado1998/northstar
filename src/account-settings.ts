import { call } from './bridge';
import { escape } from './dom';

interface AccountView {
  signedIn: boolean;
  productName: string;
  email: string;
  planName: string;
  planId: string;
  planStatus: string;
  periodEnd: string;
  allowanceLabel: string;
  includedLabel: string;
  topupLabel: string;
  reservedLabel: string;
  lowCredit: boolean;
  devicesActive: number;
  devicesAllowance: number;
  allowTopups: boolean;
  note: string;
}

interface CatalogPlan { id: string; name: string; priceLabel: string; allowanceLabel: string; self_serve?: boolean; selfServe?: boolean }
interface CatalogPack { id: string; name: string; priceLabel: string; creditLabel: string }

export function accountSettingsHtml(): string {
  return '<div id="account-settings"><p class="dialog-loading">Loading account…</p></div>';
}

export function mountAccountSettings(host: HTMLElement): () => void {
  let disposed = false;
  let polling = 0;
  const live = () => !disposed && host.isConnected;

  function paint(view: AccountView, extra = ''): void {
    const signed = view.signedIn ? `<div class="settings-group">
        <div class="setting-row"><div><strong>${escape(view.email)}</strong><small>${escape(view.planName || 'No plan')} · ${escape(view.planStatus || 'inactive')}${view.periodEnd ? ` · ${escape(view.periodEnd.slice(0, 10))}` : ''}</small></div><button type="button" class="secondary-button" data-account="sign-out">Sign out</button></div>
        <div class="setting-row"><div><strong>Included credits</strong><small>${escape(view.includedLabel)} remaining of ${escape(view.allowanceLabel || '$0.00')}</small></div></div>
        <div class="setting-row"><div><strong>Purchased credits</strong><small>${escape(view.topupLabel)} · reserved ${escape(view.reservedLabel)}</small></div></div>
        <div class="setting-row"><div><strong>Devices</strong><small>${view.devicesActive} of ${view.devicesAllowance} active</small></div></div>
        ${view.lowCredit ? '<div class="setting-row"><div><strong>Low credits</strong><small>Hosted model calls stop when both balances reach zero.</small></div></div>' : ''}
      </div>
      <h3 class="settings-heading">Plans and credits</h3><div class="settings-group" id="account-catalog"><p><small>Loading prices…</small></p></div>
      <h3 class="settings-heading">One platform completion</h3>
      <div class="settings-group"><label class="setting-row"><div><strong>Model</strong><small>Enabled models only. This does not run a local agent or upload the project.</small></div><input id="account-model" value="gpt-4.1-mini" aria-label="Platform model"></label>
        <label class="setting-row"><div><strong>Prompt</strong></div><input id="account-prompt" aria-label="Platform prompt"></label>
        <div class="setting-row"><button type="button" class="secondary-button" data-account="complete">Send</button><small id="account-result"></small></div></div>` : `<div class="settings-group"><div class="setting-row"><div><strong>Sign in</strong><small>Opens your browser. Approve the code, then return here.</small></div><button type="button" class="secondary-button" data-account="sign-in">Sign in</button></div><p id="account-code"></p></div>`;
    host.innerHTML = `${signed}<p class="settings-preview-note">${escape(extra || view.note)}</p>`;
    if (view.signedIn) void loadCatalog();
  }

  async function loadCatalog(): Promise<void> {
    const slot = host.querySelector<HTMLElement>('#account-catalog');
    if (!slot) return;
    try {
      const catalog = await call<{ plans: CatalogPlan[]; packages: CatalogPack[] }>('saas_catalog');
      if (!live() || !host.querySelector('#account-catalog')) return;
      const plans = catalog.plans.filter(plan => (plan.self_serve ?? plan.selfServe) !== false && plan.id !== 'free' && plan.id !== 'enterprise')
        .map(plan => `<button type="button" class="secondary-button" data-account="plan" data-plan="${escape(plan.id)}">${escape(plan.name)} · ${escape(plan.priceLabel)}</button>`).join(' ');
      const packs = catalog.packages.map(pack => `<button type="button" class="secondary-button" data-account="topup" data-package="${escape(pack.id)}">${escape(pack.name)} · ${escape(pack.priceLabel)}</button>`).join(' ');
      slot.innerHTML = `<div class="setting-row"><div><strong>Upgrade or renew</strong><small>Payment opens in the browser. The app updates after Paystack confirms the charge.</small></div><div class="settings-row-actions">${plans}<button type="button" class="secondary-button" data-account="renew">Renew current</button></div></div>${packs ? `<div class="setting-row"><div><strong>Buy credits</strong></div><div class="settings-row-actions">${packs}</div></div>` : ''}`;
    } catch (error) {
      if (live()) slot.innerHTML = `<p role="alert">${escape(message(error))}</p>`;
    }
  }

  async function refresh(): Promise<void> {
    try { paint(await call<AccountView>('saas_status')); }
    catch (error) { if (live()) host.innerHTML = `<p role="alert">${escape(message(error))}</p>`; }
  }

  async function onClick(event: MouseEvent): Promise<void> {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-account]') : null;
    if (!target || !host.contains(target)) return;
    const action = target.dataset.account;
    try {
      if (action === 'sign-in') {
        const started = await call<{ userCode: string; verificationUri: string }>('saas_sign_in_start');
        await call('open_external_url', { url: started.verificationUri });
        const code = host.querySelector('#account-code');
        if (code) code.textContent = `Code ${started.userCode}. Waiting for approval…`;
        window.clearInterval(polling);
        let inflight = false;
        polling = window.setInterval(async () => {
          if (inflight) return;
          inflight = true;
          try {
            const polled = await call<{ status: string; account: AccountView | null }>('saas_sign_in_poll');
            if (polled.status === 'approved' && polled.account) { window.clearInterval(polling); if (live()) paint(polled.account); }
          } catch (error) { window.clearInterval(polling); if (live()) paint(await call<AccountView>('saas_status').catch(() => empty()), message(error)); }
          finally { inflight = false; }
        }, 3000);
      } else if (action === 'sign-out') {
        await call('saas_sign_out');
        await refresh();
      } else if (action === 'plan' || action === 'topup' || action === 'renew') {
        const current = await call<AccountView>('saas_status');
        const checkout = await call<{ authorizationUrl: string }>('saas_checkout', { input: { purpose: action === 'topup' ? 'topup' : action === 'renew' ? 'renewal' : 'subscription', planId: action === 'renew' ? current.planId : target.dataset.plan, packageId: target.dataset.package } });
        await call('open_external_url', { url: checkout.authorizationUrl });
      } else if (action === 'complete') {
        const model = host.querySelector<HTMLInputElement>('#account-model')?.value ?? '';
        const prompt = host.querySelector<HTMLInputElement>('#account-prompt')?.value ?? '';
        const result = await call<{ text: string; billedMicros: string }>('saas_complete', { input: { modelId: model, prompt } });
        const slot = host.querySelector('#account-result');
        if (slot) slot.textContent = `${result.text} · billed ${result.billedMicros} micros`;
      }
    } catch (error) {
      const slot = host.querySelector('#account-result') ?? host.querySelector('.settings-preview-note');
      if (slot) slot.textContent = message(error);
    }
  }

  host.addEventListener('click', event => { void onClick(event); });
  void refresh();
  return () => { disposed = true; window.clearInterval(polling); };
}

function empty(): AccountView {
  return { signedIn: false, productName: '', email: '', planName: '', planId: '', planStatus: '', periodEnd: '', allowanceLabel: '', includedLabel: '', topupLabel: '', reservedLabel: '', lowCredit: false, devicesActive: 0, devicesAllowance: 0, allowTopups: false, note: '' };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
