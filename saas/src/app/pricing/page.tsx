import { getDb } from '@/lib/db';
import { listPlans } from '@/lib/billing';
import { formatSubunits, formatUsd, money } from '@/lib/money';
import Link from 'next/link';

export default async function PricingPage() {
  let plans: Awaited<ReturnType<typeof listPlans>> = [];
  let error = '';
  try { plans = await listPlans(await getDb()); } catch (cause) { error = cause instanceof Error ? cause.message : 'Plans are unavailable.'; }
  return <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="font-serif text-5xl">Pricing</h1>
    <p className="mt-3 max-w-2xl text-ink/75">Prices and allowances come from the database. A monthly plan includes a fixed amount of platform-model usage. It does not include unlimited model calls. Installed coding-agent subscriptions are billed by those providers, not by this allowance.</p>
    {error ? <p className="mt-6">{error}. Apply the database migration before publishing prices.</p> : <div className="mt-8 grid gap-4 md:grid-cols-3">{plans.filter(plan => plan.self_serve).map(plan => <article key={plan.id} className="panel p-5"><h2 className="font-serif text-3xl">{plan.name}</h2><p className="mt-2 text-2xl">{formatSubunits(money(plan.price_subunits), plan.currency)}<span className="text-sm text-ink/60"> / {plan.interval_days} days</span></p><p className="mt-2 text-sm">Included platform usage: {formatUsd(money(plan.included_allowance_micros))}. Devices: {plan.max_devices}. Top-ups: {plan.allow_topups ? 'yes' : 'no'}.</p><p className="mt-3 text-sm text-ink/70">{plan.description}</p>{plan.id !== 'free' ? <Link className="button button-pine mt-4" href="/sign-up">Choose {plan.name}</Link> : null}</article>)}</div>}
  </main>;
}
