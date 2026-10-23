import assert from 'node:assert/strict';
import test from 'node:test';
import { approveDevice, loginUser, pollDevice, principalFromAccessToken, principalFromWebToken, refreshDesktopSession, registerUser, startDeviceAuthorization, verifyEmail } from '../src/lib/auth';
import { applyVerifiedCharge, createCheckout } from '../src/lib/billing';
import { completeChat } from '../src/lib/gateway';
import { balances } from '../src/lib/ledger';
import type { PaystackClient } from '../src/lib/paystack';
import { testDb } from './helpers';

function mailbox() {
  const sent: string[] = [];
  return { sent, async send(message: { text: string }) { sent.push(message.text); } };
}
function tokenFrom(text: string): string {
  const token = new URL(text.slice(text.indexOf('http'))).searchParams.get('token');
  if (!token) throw new Error('missing token');
  return token;
}

test('registration, verification, device limit, and session refresh', async () => {
  const db = await testDb();
  const box = mailbox();
  const created = await registerUser(db, box, 'http://127.0.0.1:3000', { email: 'ada@example.com', password: 'correct horse battery', name: 'Ada' });
  await verifyEmail(db, tokenFrom(box.sent[0]));
  const login = await loginUser(db, 'ada@example.com', 'correct horse battery');
  assert.equal(login.userId, created.userId);
  const started = await startDeviceAuthorization(db, { deviceName: 'Mac', platform: 'macos', appVersion: '0.3.28' });
  const web = await principalFromWebToken(db, login.sessionToken);
  assert.ok(web);
  await approveDevice(db, web, started.userCode);
  const polled = await pollDevice(db, started.deviceCode);
  assert.equal(polled.status, 'approved');
  if (polled.status !== 'approved') return;
  const principal = await principalFromAccessToken(db, polled.accessToken);
  assert.equal(principal?.email, 'ada@example.com');
  const refreshed = await refreshDesktopSession(db, polled.refreshToken);
  await assert.rejects(() => refreshDesktopSession(db, polled.refreshToken), /Sign in again/);
  assert.ok(await principalFromAccessToken(db, refreshed.accessToken));
  const second = await startDeviceAuthorization(db, { deviceName: 'Other', platform: 'windows', appVersion: '0.3.28' });
  await approveDevice(db, web, second.userCode);
  await assert.rejects(() => pollDevice(db, second.deviceCode), /device limit/);
});

test('a duplicate Paystack verification does not allocate a second allowance', async () => {
  const db = await testDb();
  const box = mailbox();
  await registerUser(db, box, 'http://127.0.0.1:3000', { email: 'grace@example.com', password: 'correct horse battery', name: 'Grace' });
  await verifyEmail(db, tokenFrom(box.sent[0]));
  const login = await loginUser(db, 'grace@example.com', 'correct horse battery');
  const principal = await principalFromWebToken(db, login.sessionToken);
  assert.ok(principal);
  const paystack: PaystackClient = {
    async initialize() { return { authorizationUrl: 'https://checkout.paystack.com/test' }; },
    async verify(reference) { return { reference, amountSubunits: 2_500_000n, currency: 'NGN', status: 'success', customerCode: 'CUS_1', planCode: null, paidAt: null }; },
    async disableSubscription() { return undefined; },
  };
  const checkout = await createCheckout(db, paystack, { accountId: principal.accountId, userId: principal.userId, email: principal.email, purpose: 'subscription', planId: 'pro', callbackUrl: 'http://127.0.0.1:3000/account' });
  const charge = await paystack.verify(checkout.reference);
  assert.equal((await applyVerifiedCharge(db, charge)).applied, true);
  assert.equal((await applyVerifiedCharge(db, charge)).applied, false);
  assert.equal((await balances(db, principal.accountId)).included, 15_000_000n);
});

test('platform chat bills reported usage and does not bill a provider that omits usage', async () => {
  const db = await testDb();
  const box = mailbox();
  await registerUser(db, box, 'http://127.0.0.1:3000', { email: 'lin@example.com', password: 'correct horse battery', name: 'Lin' });
  await verifyEmail(db, tokenFrom(box.sent[0]));
  const login = await loginUser(db, 'lin@example.com', 'correct horse battery');
  const principal = await principalFromWebToken(db, login.sessionToken);
  assert.ok(principal);
  await db.query(`UPDATE ai_providers SET enabled = true WHERE id = 'openai'`);
  await db.query(`UPDATE ai_models SET enabled = true WHERE id = 'gpt-4.1-mini'`);
  process.env.OPENAI_API_KEY = 'sk-test';
  const sse = `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":0}}}\n\ndata: [DONE]\n`;
  const fetchImpl: typeof fetch = async () => new Response(sse, { status: 200 });
  const result = await completeChat(db, { ...principal, deviceId: null }, { modelId: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'Say hello' }], maxOutputTokens: 16, idempotencyKey: 'idem-12345678' }, fetchImpl);
  assert.equal(result.text, 'Hello');
  assert.equal(result.billedMicros > 0n, true);
  const replay = await completeChat(db, principal, { modelId: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'Say hello' }], maxOutputTokens: 16, idempotencyKey: 'idem-12345678' }, fetchImpl);
  assert.equal(replay.alreadyCompleted, true);
  assert.equal(replay.billedMicros, result.billedMicros);
  const before = await balances(db, principal.accountId);
  await assert.rejects(() => completeChat(db, principal, { modelId: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'Again' }], maxOutputTokens: 16, idempotencyKey: 'idem-87654321' }, async () => new Response('data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n', { status: 200 })), /not billed/);
  assert.equal((await balances(db, principal.accountId)).included, before.included);
});
