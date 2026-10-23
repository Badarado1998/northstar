import { randomUUID } from 'node:crypto';
import {
  addMember, deleteAccount, listDevices, loginUser, logoutSession, pollDevice, principalFromAccessToken,
  principalFromWebToken, refreshDesktopSession, registerUser, requestPasswordReset, resetPassword, resendVerificationEmail, revokeDevice,
  startDeviceAuthorization, verifyEmail, type Principal, ServiceError, approveDevice,
} from './auth';
import { applyVerifiedCharge, cancelAtPeriodEnd, closeExpiredPeriods, createCheckout, getPlan, listPlans } from './billing';
import { getDb, type Db } from './db';
import { completeChat, type ChatMessage } from './gateway';
import { bearer, body, clearSessionCookie, json, readCookie, sessionCookie, text, appUrl } from './http';
import { adjustCredits, balances, releaseStaleReservations } from './ledger';
import { emailConfigured, mailerFromEnv } from './mailer';
import { formatSubunits, formatUsd, money } from './money';
import { paystackClient, verifySignature } from './paystack';
import { encryptSecret } from './secrets';
import { allowRate } from './rate-limit';
import { assertSameOrigin, clientIp, paymentReference, readBody, secretsEqual } from './security';
import { isPlatformAdmin } from './admin';

async function context(request: Request): Promise<{ db: Db; principal: Principal | null }> {
  const db = await getDb();
  const token = bearer(request);
  if (token) {
    const desktop = await principalFromAccessToken(db, token);
    if (desktop) return { db, principal: desktop };
  }
  const cookie = readCookie(request, 'ns_session');
  if (cookie) return { db, principal: await principalFromWebToken(db, cookie) };
  return { db, principal: null };
}

function requireUser(principal: Principal | null): Principal {
  if (!principal) throw new ServiceError(401, 'Sign in again.');
  return principal;
}

function requireVerifiedUser(principal: Principal | null): Principal {
  const user = requireUser(principal);
  if (!user.emailVerified) throw new ServiceError(403, 'Verify your email before using the account.');
  return user;
}

async function requireAdmin(db: Db, principal: Principal): Promise<void> {
  if (!await isPlatformAdmin(db, principal.userId)) throw new ServiceError(403, 'Administrator access is required.');
}

export async function accountSnapshot(db: Db, principal: Principal) {
  const subs = await db.query<{ plan_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean; name: string; included_allowance_micros: string; max_devices: number; allow_topups: boolean; allow_byok: boolean }>(
    `SELECT s.plan_id, s.status, s.current_period_end::text, s.cancel_at_period_end, p.name, p.included_allowance_micros::text, p.max_devices, p.allow_topups, p.allow_byok
     FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.account_id = $1`, [principal.accountId]);
  const sub = subs[0];
  const credit = await balances(db, principal.accountId);
  const devices = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM devices WHERE account_id = $1 AND revoked_at IS NULL`, [principal.accountId]);
  const usage = await db.query(`SELECT r.id::text, r.model_id, r.status, r.created_at::text, COALESCE(u.billed_micros, 0)::text AS billed_micros,
      COALESCE(u.input_tokens, 0)::text AS input_tokens, COALESCE(u.output_tokens, 0)::text AS output_tokens
    FROM ai_requests r LEFT JOIN ai_usage_records u ON u.request_id = r.id
    WHERE r.account_id = $1 ORDER BY r.created_at DESC LIMIT 20`, [principal.accountId]);
  const byModel = await db.query(`SELECT r.model_id, COALESCE(SUM(u.billed_micros), 0)::text AS billed_micros, COUNT(*)::text AS requests
    FROM ai_requests r LEFT JOIN ai_usage_records u ON u.request_id = r.id
    WHERE r.account_id = $1 AND r.created_at > now() - interval '31 days'
    GROUP BY r.model_id ORDER BY r.model_id`, [principal.accountId]);
  const allowance = money(sub?.included_allowance_micros ?? '0');
  const remaining = credit.included + credit.topup;
  const threshold = await db.query<{ value: number }>(`SELECT value::text::int AS value FROM system_settings WHERE key = 'low_credit_bps'`);
  const bps = BigInt(threshold[0]?.value ?? 2000);
  return {
    signedIn: true,
    email: principal.email,
    name: principal.name,
    emailVerified: principal.emailVerified,
    plan: sub ? { id: sub.plan_id, name: sub.name, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end, periodEnd: sub.current_period_end, allowanceMicros: allowance.toString(), allowanceLabel: formatUsd(allowance), maxDevices: sub.max_devices, allowTopups: sub.allow_topups, allowByok: sub.allow_byok } : null,
    credits: {
      includedRemainingMicros: credit.included.toString(),
      topupRemainingMicros: credit.topup.toString(),
      reservedMicros: credit.reserved.toString(),
      includedLabel: formatUsd(credit.included),
      topupLabel: formatUsd(credit.topup),
      reservedLabel: formatUsd(credit.reserved),
    },
    lowCredit: allowance > 0n && remaining * 10_000n < allowance * bps,
    devices: { active: Number(devices[0]?.count ?? 0), allowance: sub?.max_devices ?? 1 },
    usage, byModel,
  };
}

async function paystack() {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) throw new ServiceError(503, 'Payments are not configured.');
  return paystackClient(secret);
}

export async function dispatch(request: Request, method: string, path: string): Promise<Response> {
  if (method === 'GET' && path === 'health') return json({ ok: true });
  if (method === 'POST' && path === 'webhooks/paystack') return paystackWebhook(request);
  if ((method === 'POST' || method === 'GET') && path === 'cron/billing') return cron(request);
  const { db, principal } = await context(request);

  if (method === 'POST' && path === 'auth/register') {
    const input = await body(request);
    const result = await registerUser(db, mailerFromEnv(), appUrl(), { email: text(input.email), password: text(input.password, 128), name: text(input.name, 80) });
    const verifyUrl = `${appUrl()}/verify-email?token=${result.verificationToken}`;
    const showVerifyLink = process.env.NODE_ENV !== 'production' || !emailConfigured();
    return json({ userId: result.userId, ...(showVerifyLink ? { devVerificationUrl: verifyUrl } : {}) }, 201);
  }
  if (method === 'GET' && path === 'auth/session') {
    if (!principal) return json({ signedIn: false });
    return json({
      signedIn: true,
      email: principal.email,
      name: principal.name,
      emailVerified: principal.emailVerified,
      platformAdmin: await isPlatformAdmin(db, principal.userId),
    });
  }
  if (method === 'POST' && path === 'auth/resend-verification') {
    assertSameOrigin(request);
    const user = requireUser(principal);
    const sent = await resendVerificationEmail(db, mailerFromEnv(), appUrl(), user.userId, user.email);
    return json({ ok: true, ...(!emailConfigured() && sent.devVerificationUrl ? { devVerificationUrl: sent.devVerificationUrl } : {}) });
  }
  if (method === 'POST' && path === 'auth/login') {
    const input = await body(request);
    const result = await loginUser(db, text(input.email), text(input.password, 128));
    const session = await principalFromWebToken(db, result.sessionToken);
    return json({ ok: true, emailVerified: Boolean(session?.emailVerified) }, 200, { 'set-cookie': sessionCookie(result.sessionToken) });
  }
  if (method === 'POST' && path === 'auth/logout') {
    assertSameOrigin(request);
    const cookie = readCookie(request, 'ns_session');
    if (cookie) await logoutSession(db, cookie);
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }
  if (method === 'POST' && path === 'auth/forgot') {
    const input = await body(request);
    const reset = await requestPasswordReset(db, mailerFromEnv(), appUrl(), text(input.email));
    return json({
      ok: true,
      ...(!emailConfigured() && reset.devResetUrl ? { devResetUrl: reset.devResetUrl } : {}),
    });
  }
  if (method === 'POST' && path === 'auth/reset') {
    const input = await body(request);
    await resetPassword(db, text(input.token, 200), text(input.password, 128));
    return json({ ok: true });
  }
  if (method === 'POST' && path === 'auth/verify') {
    const input = await body(request);
    await verifyEmail(db, text(input.token, 200));
    return json({ ok: true });
  }
  const ip = clientIp(request);
  if (method === 'POST' && path === 'auth/device/start') {
    const input = await body(request);
    const started = await startDeviceAuthorization(db, { deviceName: text(input.deviceName, 80) || 'Desktop', platform: text(input.platform, 40) || 'desktop', appVersion: text(input.appVersion, 40) }, ip);
    return json({ ...started, verificationUri: `${appUrl()}/device?code=${started.userCode}` });
  }
  if (method === 'POST' && path === 'auth/device/approve') {
    assertSameOrigin(request);
    const input = await body(request);
    await approveDevice(db, requireVerifiedUser(principal), text(input.userCode, 20));
    return json({ ok: true });
  }
  if (method === 'POST' && path === 'auth/device/token') {
    const input = await body(request);
    return json(await pollDevice(db, text(input.deviceCode, 200), ip));
  }
  if (method === 'POST' && path === 'auth/desktop/refresh') {
    const input = await body(request);
    return json(await refreshDesktopSession(db, text(input.refreshToken, 200), ip));
  }
  if (method === 'GET' && path === 'account') {
    const user = requireVerifiedUser(principal);
    return json(await accountSnapshot(db, user));
  }
  if (method === 'DELETE' && path === 'account') {
    assertSameOrigin(request);
    await deleteAccount(db, requireUser(principal));
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }
  if (method === 'GET' && path === 'account/devices') return json({ devices: await listDevices(db, requireVerifiedUser(principal).accountId) });
  if (method === 'POST' && path === 'account/devices/revoke') {
    assertSameOrigin(request);
    const input = await body(request);
    await revokeDevice(db, requireVerifiedUser(principal), text(input.deviceId, 80));
    return json({ ok: true });
  }
  if (method === 'POST' && path === 'account/members') {
    assertSameOrigin(request);
    const input = await body(request);
    await addMember(db, requireVerifiedUser(principal), text(input.email));
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'billing/plans') {
    const plans = await listPlans(db);
    const packages = await db.query(`SELECT id, name, currency, price_subunits::text, credit_micros::text, active FROM topup_packages WHERE active = true ORDER BY price_subunits`);
    return json({
      plans: plans.map(plan => ({ ...plan, priceLabel: formatSubunits(money(plan.price_subunits), plan.currency), allowanceLabel: formatUsd(money(plan.included_allowance_micros)) })),
      packages: packages.map(pack => ({ ...pack, priceLabel: formatSubunits(money((pack as { price_subunits: string }).price_subunits), (pack as { currency: string }).currency), creditLabel: formatUsd(money((pack as { credit_micros: string }).credit_micros)) })),
    });
  }
  if (method === 'GET' && path === 'billing/summary') return json(await accountSnapshot(db, requireVerifiedUser(principal)));
  if (method === 'POST' && path === 'billing/checkout') {
    assertSameOrigin(request);
    const user = requireVerifiedUser(principal);
    if (!await allowRate(db, `checkout:${user.accountId}`, 12, 3600)) throw new ServiceError(429, 'Too many checkout attempts. Try again later.');
    const input = await body(request);
    const purpose = text(input.purpose, 20);
    if (purpose !== 'subscription' && purpose !== 'renewal' && purpose !== 'topup') throw new ServiceError(400, 'Choose a subscription, renewal, or credit top-up.');
    const checkout = await createCheckout(db, await paystack(), {
      accountId: user.accountId, userId: user.userId, email: user.email, purpose, planId: text(input.planId, 40) || undefined, packageId: text(input.packageId, 40) || undefined, callbackUrl: `${appUrl()}/account/billing`,
    });
    return json(checkout);
  }
  if (method === 'POST' && path === 'billing/cancel') {
    assertSameOrigin(request);
    const user = requireVerifiedUser(principal);
    await cancelAtPeriodEnd(db, user.accountId);
    const sub = await db.query<{ provider_subscription_code: string | null }>(`SELECT provider_subscription_code FROM subscriptions WHERE account_id = $1`, [user.accountId]);
    return json({ ok: true, paystackManaged: Boolean(sub[0]?.provider_subscription_code), note: sub[0]?.provider_subscription_code ? 'The local subscription ends at the period boundary. Disable the matching Paystack plan in the Paystack dashboard so it does not charge again. Paystack disable also requires an email token that is not stored here.' : 'The subscription ends at the period boundary. Included credits expire then. Purchased credits stay.' });
  }
  if (method === 'POST' && path === 'v1/ai/chat') {
    const user = requireVerifiedUser(principal);
    const input = await body(request);
    const messages: ChatMessage[] = [];
    if (Array.isArray(input.messages)) {
      for (const message of input.messages) {
        if (!message || typeof message !== 'object') continue;
        const role = (message as { role?: unknown }).role;
        const content = (message as { content?: unknown }).content;
        if ((role === 'user' || role === 'assistant') && typeof content === 'string') messages.push({ role, content });
      }
    }
    const result = await completeChat(db, user, {
      modelId: text(input.modelId, 80),
      messages,
      maxOutputTokens: Number(input.maxOutputTokens ?? 256),
      idempotencyKey: text(input.idempotencyKey, 80),
      projectRef: text(input.projectRef, 80) || null,
      conversationRef: text(input.conversationRef, 80) || null,
    });
    return json({ ...result, billedMicros: result.billedMicros.toString(), providerCostMicros: result.providerCostMicros.toString(), usage: { inputTokens: result.usage.inputTokens.toString(), outputTokens: result.usage.outputTokens.toString(), cacheReadTokens: result.usage.cacheReadTokens.toString(), cacheWriteTokens: result.usage.cacheWriteTokens.toString() } });
  }
  if (path.startsWith('admin/')) return admin(request, method, path, db, requireVerifiedUser(principal));
  return json({ error: 'Not found.' }, 404);
}

async function paystackWebhook(request: Request): Promise<Response> {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) return json({ error: 'Payments are not configured.' }, 503);
  const ip = clientIp(request);
  const db = await getDb();
  let raw: string;
  try {
    raw = await readBody(request, 256 * 1024);
  } catch (error) {
    if (error instanceof ServiceError) return json({ error: error.message }, error.status);
    throw error;
  }
  const signature = request.headers.get('x-paystack-signature') ?? '';
  if (!verifySignature(raw, signature, secret)) {
    if (!await allowRate(db, `webhook:bad:${ip}`, 40, 3600)) return json({ error: 'Invalid signature.' }, 429);
    return json({ error: 'Invalid signature.' }, 401);
  }
  let event: { event?: string; data?: { id?: number; reference?: string; amount?: number; currency?: string; status?: string; customer?: { customer_code?: string }; plan?: { plan_code?: string } | string } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return json({ error: 'Unrecognized event.' }, 400);
  }
  const eventId = String(event.data?.id ?? event.data?.reference ?? '');
  if (!event.event || !eventId) return json({ error: 'Unrecognized event.' }, 400);
  const inserted = await db.query<{ id: string }>(`INSERT INTO payment_webhook_events (id, provider, event_id, event_type, payload)
    VALUES ($1, 'paystack', $2, $3, $4::jsonb) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id::text`, [randomUUID(), `${event.event}:${eventId}`, event.event, raw]);
  if (!inserted.length) return json({ ok: true, duplicate: true });
  if (event.event === 'charge.success' && event.data?.reference) {
    if (!paymentReference(event.data.reference)) return json({ error: 'Unrecognized reference.' }, 400);
    const charge = await paystackClient(secret).verify(event.data.reference);
    if (charge.status !== 'success' || !paymentReference(charge.reference)) return json({ ok: true, ignored: true });
    await applyVerifiedCharge(db, charge);
  }
  if (event.event === 'invoice.payment_failed' || event.event === 'charge.failed') {
    const reference = event.data?.reference;
    if (reference) await db.query(`UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE account_id IN (SELECT account_id FROM checkout_sessions WHERE provider_reference = $1) AND status = 'active'`, [reference]);
  }
  if (event.event === 'charge.dispute.create') {
    await db.query(`UPDATE accounts SET billing_hold = true WHERE id IN (SELECT account_id FROM payments WHERE provider_reference = $1)`, [event.data?.reference ?? '']);
  }
  await db.query(`UPDATE payment_webhook_events SET processed_at = now() WHERE id = $1`, [inserted[0].id]);
  return json({ ok: true });
}

async function cron(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  const header = request.headers.get('x-cron-secret') ?? '';
  const bearerOk = authHeader.startsWith('Bearer ') && secretsEqual(authHeader.slice(7), secret ?? '');
  const headerOk = secret ? secretsEqual(header, secret) : false;
  if (!secret || (!bearerOk && !headerOk)) return json({ error: 'Unauthorized.' }, 401);
  const db = await getDb();
  const closed = await closeExpiredPeriods(db);
  const released = await releaseStaleReservations(db);
  return json({ closed, released });
}

async function admin(request: Request, method: string, path: string, db: Db, principal: Principal): Promise<Response> {
  if (method !== 'GET') assertSameOrigin(request);
  const ip = clientIp(request);
  if (!await allowRate(db, `admin:${principal.userId}:${ip}`, 120, 900)) throw new ServiceError(429, 'Too many admin requests.');
  if (method === 'POST' && path === 'admin/bootstrap') {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const existing = await db.query(`SELECT 1 FROM platform_admins LIMIT 1`);
    if (existing.length) throw new ServiceError(403, 'An administrator already exists.');
    if (!email || principal.email !== email) throw new ServiceError(403, 'This account cannot become the first administrator.');
    await db.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [principal.userId]);
    return json({ ok: true });
  }
  await requireAdmin(db, principal);
  if (method === 'GET' && path === 'admin/overview') return json(await overview(db));
  if (method === 'GET' && path === 'admin/users') {
    const query = new URL(request.url).searchParams.get('q')?.trim().toLowerCase() ?? '';
    return json({ users: await db.query(`SELECT u.id::text, u.email, u.name, u.status, u.email_verified_at IS NOT NULL AS verified, s.plan_id, s.status AS subscription_status
      FROM users u LEFT JOIN memberships m ON m.user_id = u.id AND m.role = 'owner'
      LEFT JOIN subscriptions s ON s.account_id = m.account_id
      WHERE ($1 = '' OR lower(u.email) LIKE $2) ORDER BY u.created_at DESC LIMIT 50`, [query, `%${query}%`]) });
  }
  if (method === 'POST' && path === 'admin/users') {
    const input = await body(request);
    const action = text(input.action, 20);
    const userId = text(input.userId, 80);
    if (action !== 'suspend' && action !== 'restore') throw new ServiceError(400, 'Choose suspend or restore.');
    await db.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [userId, action === 'suspend' ? 'suspended' : 'active']);
    if (action === 'suspend') await db.query(`UPDATE desktop_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await db.query(`INSERT INTO admin_audit_logs (id, actor_user_id, action, target) VALUES ($1, $2, $3, $4)`, [randomUUID(), principal.userId, `user.${action}`, userId]);
    return json({ ok: true });
  }
  if (method === 'POST' && path === 'admin/credits') {
    const input = await body(request);
    const result = await adjustCredits(db, { accountId: text(input.accountId, 80), includedDelta: money(input.includedDelta ?? '0'), topupDelta: money(input.topupDelta ?? '0'), idempotencyKey: text(input.idempotencyKey, 80), reason: text(input.reason, 200), actorUserId: principal.userId });
    if (!result.ok) throw new ServiceError(400, result.error);
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'admin/plans') return json({ plans: await listPlans(db), packages: await db.query(`SELECT * FROM topup_packages ORDER BY price_subunits`) });
  if (method === 'POST' && path === 'admin/plans') {
    const input = await body(request);
    const id = text(input.id, 40);
    const plan = await getPlan(db, id);
    if (!plan) throw new ServiceError(404, 'Plan not found.');
    await db.query(`UPDATE subscription_plans SET name = $2, price_subunits = $3, included_allowance_micros = $4, max_devices = $5, active = $6, allow_topups = $7, paystack_plan_code = $8, updated_at = now() WHERE id = $1`, [
      id, text(input.name, 80) || plan.name, text(input.priceSubunits, 20) || plan.price_subunits, text(input.includedAllowanceMicros, 20) || plan.included_allowance_micros, Number(input.maxDevices ?? plan.max_devices), Boolean(input.active), Boolean(input.allowTopups), text(input.paystackPlanCode, 80) || null,
    ]);
    await db.query(`INSERT INTO admin_audit_logs (id, actor_user_id, action, target, metadata) VALUES ($1, $2, 'plan.update', $3, $4::jsonb)`, [randomUUID(), principal.userId, id, JSON.stringify({ priceSubunits: input.priceSubunits, includedAllowanceMicros: input.includedAllowanceMicros })]);
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'admin/providers') {
    const providers = await db.query<{ id: string; name: string; kind: string; enabled: boolean; secret_env: string | null; secret_ciphertext: string | null }>(`SELECT id, name, kind, enabled, secret_env, secret_ciphertext FROM ai_providers ORDER BY id`);
    const models = await db.query(`SELECT m.id, m.display_name, m.provider_id, m.enabled, p.input_micros_per_million::text, p.output_micros_per_million::text, p.markup_bps FROM ai_models m LEFT JOIN LATERAL (SELECT * FROM model_prices WHERE model_id = m.id ORDER BY effective_from DESC LIMIT 1) p ON true ORDER BY m.id`);
    return json({ providers: providers.map(provider => ({ id: provider.id, name: provider.name, kind: provider.kind, enabled: provider.enabled, secretEnv: provider.secret_env, secretConfigured: Boolean(provider.secret_ciphertext || (provider.secret_env && process.env[provider.secret_env])) })), models });
  }
  if (method === 'POST' && path === 'admin/providers') {
    const input = await body(request);
    const id = text(input.id, 40);
    if (typeof input.apiKey === 'string' && input.apiKey) {
      const key = process.env.SECRETS_KEY?.trim();
      if (!key) throw new ServiceError(503, 'Set SECRETS_KEY before storing a provider key.');
      await db.query(`UPDATE ai_providers SET secret_ciphertext = $2 WHERE id = $1`, [id, encryptSecret(input.apiKey, key)]);
    }
    if (typeof input.enabled === 'boolean') await db.query(`UPDATE ai_providers SET enabled = $2 WHERE id = $1`, [id, input.enabled]);
    if (input.modelId && typeof input.modelEnabled === 'boolean') await db.query(`UPDATE ai_models SET enabled = $2 WHERE id = $1`, [text(input.modelId, 80), input.modelEnabled]);
    if (input.modelId && input.markupBps) {
      await db.query(`INSERT INTO model_prices (id, model_id, input_micros_per_million, output_micros_per_million, cache_read_micros_per_million, cache_write_micros_per_million, markup_bps)
        SELECT $1, model_id, input_micros_per_million, output_micros_per_million, cache_read_micros_per_million, cache_write_micros_per_million, $3
        FROM model_prices WHERE model_id = $2 ORDER BY effective_from DESC LIMIT 1`, [randomUUID(), text(input.modelId, 80), Number(input.markupBps)]);
    }
    await db.query(`INSERT INTO admin_audit_logs (id, actor_user_id, action, target) VALUES ($1, $2, 'provider.update', $3)`, [randomUUID(), principal.userId, id]);
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'admin/finance') return json(await finance(db));
  return json({ error: 'Not found.' }, 404);
}

async function overview(db: Db) {
  const counts = await db.query<{ users: string; active: string; paying: string; free_users: string }>(`SELECT
    (SELECT count(*) FROM users WHERE deleted_at IS NULL)::text AS users,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND status = 'active')::text AS active,
    (SELECT count(*) FROM subscriptions WHERE status = 'active' AND plan_id <> 'free')::text AS paying,
    (SELECT count(*) FROM subscriptions WHERE plan_id = 'free')::text AS free_users`);
  const revenue = await db.query(`SELECT currency, COALESCE(SUM(amount_subunits), 0)::text AS amount_subunits, COUNT(*)::text AS payments
    FROM payments WHERE status = 'succeeded' GROUP BY currency`);
  const ai = await db.query<{ requests: string; billed: string; provider: string }>(`SELECT COUNT(*)::text AS requests, COALESCE(SUM(billed_micros),0)::text AS billed, COALESCE(SUM(provider_cost_micros),0)::text AS provider FROM ai_usage_records`);
  const recent = await db.query(`SELECT id::text, provider_reference, amount_subunits::text, currency, purpose, status, created_at::text FROM payments ORDER BY created_at DESC LIMIT 10`);
  const failed = await db.query(`SELECT id::text, provider_reference, amount_subunits::text, currency, status, created_at::text FROM payments WHERE status IN ('failed', 'disputed') ORDER BY created_at DESC LIMIT 10`);
  return { counts: counts[0], revenue, ai: ai[0], recent, failed };
}

async function finance(db: Db) {
  const revenue = await db.query(`SELECT purpose, currency, COALESCE(SUM(amount_subunits),0)::text AS amount_subunits, COUNT(*)::text AS payments FROM payments WHERE status = 'succeeded' GROUP BY purpose, currency ORDER BY purpose`);
  const ai = await db.query(`SELECT model_id, COALESCE(SUM(u.billed_micros),0)::text AS billed_micros, COALESCE(SUM(u.provider_cost_micros),0)::text AS provider_cost_micros, COUNT(*)::text AS requests
    FROM ai_usage_records u JOIN ai_requests r ON r.id = u.request_id GROUP BY model_id ORDER BY model_id`);
  const refunds = await db.query(`SELECT id::text, provider_reference, amount_subunits::text, currency, created_at::text FROM payments WHERE status = 'refunded' ORDER BY created_at DESC LIMIT 50`);
  return { revenue, ai, refunds };
}
