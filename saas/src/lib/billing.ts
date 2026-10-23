import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import { ensureCreditAccount, expireIncluded, grantTopup, openAllowancePeriod } from './ledger';
import { money } from './money';
import { amountMatches, type PaystackClient, type VerifiedCharge } from './paystack';

export interface PlanRow {
  id: string;
  name: string;
  description: string;
  currency: string;
  price_subunits: string;
  interval_days: number;
  included_allowance_micros: string;
  trial_allowance_micros: string;
  trial_days: number;
  max_devices: number;
  max_team_members: number;
  max_concurrent_requests: number;
  max_request_micros: string;
  allow_topups: boolean;
  allow_byok: boolean;
  self_serve: boolean;
  active: boolean;
  model_access: 'all' | 'listed';
  paystack_plan_code: string | null;
}

const PLAN_COLUMNS = `id, name, description, currency, price_subunits::text, interval_days,
  included_allowance_micros::text, trial_allowance_micros::text, trial_days, max_devices, max_team_members,
  max_concurrent_requests, max_request_micros::text, allow_topups, allow_byok, self_serve, active, model_access, paystack_plan_code`;

export async function listPlans(db: Db): Promise<PlanRow[]> {
  return db.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM subscription_plans WHERE active = true ORDER BY price_subunits, id`);
}

export async function getPlan(db: Db, id: string): Promise<PlanRow | null> {
  const rows = await db.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM subscription_plans WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function startTrial(db: Db, accountId: string): Promise<void> {
  const plan = await getPlan(db, 'free');
  if (!plan) throw new Error('The free plan is missing.');
  await db.transaction(async tx => {
    await ensureCreditAccount(tx, accountId);
    const subscriptionId = randomUUID();
    const periodId = randomUUID();
    const now = new Date();
    const end = new Date(now.getTime() + Math.max(plan.trial_days, 1) * 86_400_000);
    await tx.query(`INSERT INTO subscriptions (id, account_id, plan_id, status, current_period_start, current_period_end)
      VALUES ($1, $2, 'free', 'trialing', $3, $4)`, [subscriptionId, accountId, now.toISOString(), end.toISOString()]);
    await tx.query(`INSERT INTO billing_periods (id, account_id, subscription_id, plan_id, starts_at, ends_at, included_micros, status, source_key)
      VALUES ($1, $2, $3, 'free', $4, $5, $6, 'open', $7)`, [
      periodId, accountId, subscriptionId, now.toISOString(), end.toISOString(), plan.trial_allowance_micros, `trial:${accountId}`,
    ]);
    await openAllowancePeriod(tx, { accountId, previousPeriodId: null, periodId, amountMicros: money(plan.trial_allowance_micros) });
  });
}

export async function createCheckout(db: Db, paystack: PaystackClient, input: {
  accountId: string;
  userId: string;
  email: string;
  purpose: 'subscription' | 'renewal' | 'topup';
  planId?: string;
  packageId?: string;
  callbackUrl: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const verified = await db.query<{ billing_hold: boolean }>(`SELECT u.id, a.billing_hold FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.role = 'owner'
    JOIN accounts a ON a.id = m.account_id
    WHERE u.id = $1 AND u.email_verified_at IS NOT NULL AND u.status = 'active' AND a.id = $2`, [input.userId, input.accountId]);
  if (!verified.length) throw Object.assign(new Error('Verify your email before paying.'), { status: 403 });
  if (verified[0].billing_hold) throw Object.assign(new Error('Billing is on hold for this account. Contact support.'), { status: 402 });
  let amount = 0n;
  let currency = 'NGN';
  let planCode: string | null = null;
  if (input.purpose === 'topup') {
    const rows = await db.query<{ price_subunits: string; currency: string; active: boolean }>(`SELECT price_subunits::text, currency, active FROM topup_packages WHERE id = $1`, [input.packageId]);
    const pack = rows[0];
    if (!pack?.active) throw Object.assign(new Error('That credit package is not available.'), { status: 404 });
    const plan = await currentPlan(db, input.accountId);
    if (!plan?.allow_topups) throw Object.assign(new Error('This plan cannot buy extra credits.'), { status: 403 });
    amount = money(pack.price_subunits);
    currency = pack.currency;
  } else {
    const plan = await getPlan(db, input.planId ?? '');
    if (!plan || !plan.active || !plan.self_serve || money(plan.price_subunits) <= 0n) {
      throw Object.assign(new Error('That plan cannot be purchased here.'), { status: 400 });
    }
    amount = money(plan.price_subunits);
    currency = plan.currency;
    planCode = plan.paystack_plan_code;
  }
  const reference = `ns_${randomUUID().replaceAll('-', '')}`;
  const checkoutId = randomUUID();
  await db.query(`INSERT INTO checkout_sessions (
      id, account_id, user_id, purpose, plan_id, topup_package_id, amount_subunits, currency, provider_reference
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    checkoutId, input.accountId, input.userId, input.purpose, input.planId ?? null, input.packageId ?? null, amount.toString(), currency, reference,
  ]);
  try {
    const started = await paystack.initialize({
      email: input.email,
      amountSubunits: amount,
      currency,
      reference,
      callbackUrl: input.callbackUrl,
      planCode,
      metadata: { checkoutId, purpose: input.purpose },
    });
    return { authorizationUrl: started.authorizationUrl, reference };
  } catch (error) {
    await db.query(`UPDATE checkout_sessions SET status = 'failed' WHERE id = $1`, [checkoutId]);
    throw error;
  }
}

async function currentPlan(db: Db, accountId: string): Promise<PlanRow | null> {
  const rows = await db.query<{ plan_id: string }>(`SELECT plan_id FROM subscriptions WHERE account_id = $1`, [accountId]);
  if (!rows[0]) return null;
  return getPlan(db, rows[0].plan_id);
}

export async function applyVerifiedCharge(db: Db, charge: VerifiedCharge): Promise<{ applied: boolean; status: string }> {
  return db.transaction(async tx => {
    const sessions = await tx.query<{
      id: string; account_id: string; purpose: 'subscription' | 'renewal' | 'topup'; plan_id: string | null;
      topup_package_id: string | null; amount_subunits: string; currency: string; status: string;
    }>(`SELECT id::text, account_id::text, purpose, plan_id, topup_package_id, amount_subunits::text, currency, status
        FROM checkout_sessions WHERE provider_reference = $1 FOR UPDATE`, [charge.reference]);
    const session = sessions[0];
    if (!session) return { applied: false, status: 'unknown' };
    if (session.status === 'paid') return { applied: false, status: 'paid' };
    if (charge.status !== 'success' || !amountMatches(money(session.amount_subunits), charge.amountSubunits, session.currency, charge.currency)) {
      await tx.query(`UPDATE checkout_sessions SET status = 'failed' WHERE id = $1`, [session.id]);
      await tx.query(`INSERT INTO payments (id, account_id, checkout_id, provider, provider_reference, amount_subunits, currency, purpose, status, metadata)
        VALUES ($1,$2,$3,'paystack',$4,$5,$6,$7,'failed',$8::jsonb)
        ON CONFLICT (provider_reference) DO NOTHING`, [
        randomUUID(), session.account_id, session.id, charge.reference, charge.amountSubunits.toString(), charge.currency, session.purpose,
        JSON.stringify({
          reason: charge.status === 'success' ? 'amount_mismatch' : charge.status,
          expectedSubunits: session.amount_subunits,
          receivedSubunits: charge.amountSubunits.toString(),
        }),
      ]);
      await tx.query(`INSERT INTO admin_audit_logs (id, actor_user_id, action, target, metadata) VALUES ($1, NULL, 'payment.rejected', $2, $3::jsonb)`, [
        randomUUID(), charge.reference, JSON.stringify({ accountId: session.account_id, reason: charge.status === 'success' ? 'amount_mismatch' : charge.status }),
      ]);
      return { applied: false, status: 'failed' };
    }
    const paymentId = randomUUID();
    const inserted = await tx.query<{ id: string }>(`INSERT INTO payments (
        id, account_id, checkout_id, provider, provider_reference, amount_subunits, currency, purpose, status, metadata
      ) VALUES ($1,$2,$3,'paystack',$4,$5,$6,$7,'succeeded',$8::jsonb)
      ON CONFLICT (provider_reference) DO NOTHING RETURNING id::text`, [
      paymentId, session.account_id, session.id, charge.reference, charge.amountSubunits.toString(), charge.currency, session.purpose,
      JSON.stringify({ customerCode: charge.customerCode, planCode: charge.planCode }),
    ]);
    if (!inserted.length) {
      await tx.query(`UPDATE checkout_sessions SET status = 'paid', paid_at = now() WHERE id = $1 AND status <> 'paid'`, [session.id]);
      return { applied: false, status: 'paid' };
    }
    if (session.purpose === 'topup') {
      const packs = await tx.query<{ credit_micros: string; expires_in_days: number | null }>(`SELECT credit_micros::text, expires_in_days FROM topup_packages WHERE id = $1`, [session.topup_package_id]);
      const credit = money(packs[0]?.credit_micros ?? '0');
      if (credit <= 0n) throw new Error('Credit package is missing.');
      await grantTopup(tx, { accountId: session.account_id, paymentId, amountMicros: credit });
      const expires = packs[0].expires_in_days ? new Date(Date.now() + packs[0].expires_in_days * 86_400_000).toISOString() : null;
      await tx.query(`INSERT INTO credit_topups (id, account_id, payment_id, amount_micros, expires_at) VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), session.account_id, paymentId, credit.toString(), expires]);
    } else {
      await activatePlan(tx, session.account_id, session.plan_id ?? '', `payment:${charge.reference}`, charge.customerCode, charge.planCode);
    }
    await tx.query(`UPDATE checkout_sessions SET status = 'paid', paid_at = now() WHERE id = $1`, [session.id]);
    return { applied: true, status: 'paid' };
  });
}

async function activatePlan(tx: Db, accountId: string, planId: string, sourceKey: string, customerCode: string | null, planCode: string | null): Promise<void> {
  const plans = await tx.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM subscription_plans WHERE id = $1`, [planId]);
  const plan = plans[0];
  if (!plan) throw new Error('Plan is missing.');
  const subs = await tx.query<{ id: string; period_id: string | null }>(`SELECT s.id::text, c.period_id::text AS period_id
    FROM subscriptions s JOIN credit_accounts c ON c.account_id = s.account_id
    WHERE s.account_id = $1 FOR UPDATE OF s`, [accountId]);
  const subscription = subs[0];
  if (!subscription) throw new Error('Subscription is missing.');
  const periodId = randomUUID();
  const start = new Date();
  const end = new Date(start.getTime() + plan.interval_days * 86_400_000);
  const period = await tx.query<{ id: string }>(`INSERT INTO billing_periods (
      id, account_id, subscription_id, plan_id, starts_at, ends_at, included_micros, status, source_key
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8)
    ON CONFLICT (source_key) DO NOTHING RETURNING id::text`, [
    periodId, accountId, subscription.id, plan.id, start.toISOString(), end.toISOString(), plan.included_allowance_micros, sourceKey,
  ]);
  const created = Boolean(period[0]);
  const effectivePeriod = period[0]?.id ?? (await tx.query<{ id: string }>(`SELECT id::text FROM billing_periods WHERE source_key = $1`, [sourceKey]))[0].id;
  if (!created) return;
  await tx.query(`UPDATE billing_periods SET status = 'closed' WHERE account_id = $1 AND status = 'open' AND id <> $2`, [accountId, effectivePeriod]);
  await openAllowancePeriod(tx, {
    accountId,
    previousPeriodId: subscription.period_id,
    periodId: effectivePeriod,
    amountMicros: money(plan.included_allowance_micros),
  });
  await tx.query(`UPDATE subscriptions SET plan_id = $2, status = 'active', current_period_start = $3, current_period_end = $4,
      cancel_at_period_end = false, provider = 'paystack', provider_customer_code = COALESCE($5, provider_customer_code),
      provider_subscription_code = COALESCE($6, provider_subscription_code), updated_at = now()
    WHERE account_id = $1`, [accountId, plan.id, start.toISOString(), end.toISOString(), customerCode, planCode]);
  await tx.query(`INSERT INTO subscription_events (id, subscription_id, kind, payload) VALUES ($1,$2,'activated',$3::jsonb)`, [
    randomUUID(), subscription.id, JSON.stringify({ planId, sourceKey }),
  ]);
}

export async function markPastDue(db: Db, accountId: string): Promise<void> {
  await db.query(`UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE account_id = $1 AND status = 'active'`, [accountId]);
}

export async function cancelAtPeriodEnd(db: Db, accountId: string): Promise<void> {
  await db.query(`UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE account_id = $1 AND status IN ('active', 'trialing', 'past_due')`, [accountId]);
}

export async function closeExpiredPeriods(db: Db): Promise<number> {
  const rows = await db.query<{ account_id: string; period_id: string | null; cancel_at_period_end: boolean; id: string }>(
    `SELECT s.account_id::text, c.period_id::text AS period_id, s.cancel_at_period_end, s.id::text
     FROM subscriptions s JOIN credit_accounts c ON c.account_id = s.account_id
     WHERE s.current_period_end < now() AND s.status IN ('active', 'trialing', 'past_due')`);
  for (const row of rows) {
    if (row.period_id) await expireIncluded(db, { accountId: row.account_id, periodId: row.period_id });
    await db.query(`UPDATE subscriptions SET status = $2, updated_at = now() WHERE id = $1`, [row.id, row.cancel_at_period_end ? 'canceled' : 'past_due']);
    await db.query(`UPDATE billing_periods SET status = 'closed' WHERE account_id = $1 AND status = 'open'`, [row.account_id]);
  }
  return rows.length;
}
