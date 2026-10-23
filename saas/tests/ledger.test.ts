import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { allocateIncluded, balances, expireIncluded, grantTopup, ledgerTotals, openAllowancePeriod, releaseReservation, reserveCredits, settleReservation } from '../src/lib/ledger';
import { testDb } from './helpers';

async function account(db: Awaited<ReturnType<typeof testDb>>): Promise<string> {
  const userId = randomUUID();
  const accountId = randomUUID();
  await db.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Ada')`, [userId, `${userId}@example.com`]);
  await db.query(`INSERT INTO accounts (id, name, kind, owner_user_id) VALUES ($1, 'Ada', 'personal', $2)`, [accountId, userId]);
  await db.query(`INSERT INTO credit_accounts (account_id) VALUES ($1)`, [accountId]);
  return accountId;
}

async function expectIdentity(db: Awaited<ReturnType<typeof testDb>>, accountId: string) {
  const live = await balances(db, accountId);
  const summed = await ledgerTotals(db, accountId);
  assert.equal(live.included, summed.included);
  assert.equal(live.topup, summed.topup);
  assert.equal(live.reserved, summed.reserved);
}

test('included allowance is allocated once and a second reserve cannot overdraw', async () => {
  const db = await testDb();
  const id = await account(db);
  const period = randomUUID();
  assert.deepEqual(await allocateIncluded(db, { accountId: id, periodId: period, amountMicros: 1_000_000n }), { applied: true });
  assert.deepEqual(await allocateIncluded(db, { accountId: id, periodId: period, amountMicros: 1_000_000n }), { applied: false });
  const first = await reserveCredits(db, { accountId: id, requestKey: 'one', amountMicros: 600_000n, maxConcurrent: 2 });
  const second = await reserveCredits(db, { accountId: id, requestKey: 'two', amountMicros: 600_000n, maxConcurrent: 2 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, 'insufficient_credits');
  await expectIdentity(db, id);
});

test('settlement returns unused included credits and a replay does not charge again', async () => {
  const db = await testDb();
  const id = await account(db);
  const period = randomUUID();
  await allocateIncluded(db, { accountId: id, periodId: period, amountMicros: 1_000_000n });
  await reserveCredits(db, { accountId: id, requestKey: 'job', amountMicros: 400_000n, maxConcurrent: 2 });
  const settled = await settleReservation(db, { accountId: id, requestKey: 'job', billedMicros: 150_000n });
  assert.equal(settled.ok, true);
  if (settled.ok) assert.equal(settled.billedMicros, 150_000n);
  const again = await settleReservation(db, { accountId: id, requestKey: 'job', billedMicros: 150_000n });
  assert.equal(again.ok, true);
  const live = await balances(db, id);
  assert.equal(live.included, 850_000n);
  assert.equal(live.reserved, 0n);
  await expectIdentity(db, id);
});

test('renewal expires leftover included credits and keeps purchased credits', async () => {
  const db = await testDb();
  const id = await account(db);
  const first = randomUUID();
  const second = randomUUID();
  await allocateIncluded(db, { accountId: id, periodId: first, amountMicros: 1_000_000n });
  await grantTopup(db, { accountId: id, paymentId: randomUUID(), amountMicros: 500_000n });
  await reserveCredits(db, { accountId: id, requestKey: 'inflight', amountMicros: 200_000n, maxConcurrent: 2 });
  await openAllowancePeriod(db, { accountId: id, previousPeriodId: first, periodId: second, amountMicros: 2_000_000n });
  const during = await balances(db, id);
  assert.equal(during.included, 2_000_000n);
  assert.equal(during.topup, 500_000n);
  assert.equal(during.reserved, 200_000n);
  const settled = await settleReservation(db, { accountId: id, requestKey: 'inflight', billedMicros: 50_000n });
  assert.equal(settled.ok, true);
  if (settled.ok) assert.equal(settled.expiredIncludedMicros, 150_000n);
  const live = await balances(db, id);
  assert.equal(live.included, 2_000_000n);
  assert.equal(live.topup, 500_000n);
  await expectIdentity(db, id);
  const expired = await expireIncluded(db, { accountId: id, periodId: second });
  assert.equal(expired.expiredMicros, 2_000_000n);
  assert.equal((await balances(db, id)).topup, 500_000n);
  assert.equal((await expireIncluded(db, { accountId: id, periodId: second })).expiredMicros, 0n);
});

test('a failed request releases the full hold', async () => {
  const db = await testDb();
  const id = await account(db);
  await allocateIncluded(db, { accountId: id, periodId: randomUUID(), amountMicros: 100_000n });
  await reserveCredits(db, { accountId: id, requestKey: 'fail', amountMicros: 80_000n, maxConcurrent: 1 });
  const blocked = await reserveCredits(db, { accountId: id, requestKey: 'other', amountMicros: 10_000n, maxConcurrent: 1 });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'too_many_requests');
  await releaseReservation(db, { accountId: id, requestKey: 'fail' });
  assert.equal((await balances(db, id)).included, 100_000n);
  await expectIdentity(db, id);
});

test('the same top-up payment cannot credit the account twice', async () => {
  const db = await testDb();
  const id = await account(db);
  const paymentId = randomUUID();
  assert.equal((await grantTopup(db, { accountId: id, paymentId, amountMicros: 250_000n })).applied, true);
  assert.equal((await grantTopup(db, { accountId: id, paymentId, amountMicros: 250_000n })).applied, false);
  assert.equal((await balances(db, id)).topup, 250_000n);
  await expectIdentity(db, id);
});
