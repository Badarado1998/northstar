import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import { money } from './money';

export type LedgerFailure = { ok: false; code: 'insufficient_credits' | 'too_many_requests' | 'not_held' | 'missing'; error: string };

interface AccountLock {
  periodId: string | null;
  included: bigint;
  topup: bigint;
  reserved: bigint;
}

interface ReservationRow {
  id: string;
  account_id: string;
  request_key: string;
  period_id: string | null;
  reserved_micros: string;
  included_portion_micros: string;
  topup_portion_micros: string;
  consumed_micros: string;
  status: 'held' | 'settled' | 'released';
}

export interface Reservation {
  id: string;
  requestKey: string;
  periodId: string | null;
  reservedMicros: bigint;
  includedPortionMicros: bigint;
  topupPortionMicros: bigint;
  consumedMicros: bigint;
  status: 'held' | 'settled' | 'released';
  reused: boolean;
}

function mapReservation(row: ReservationRow, reused: boolean): Reservation {
  return {
    id: row.id,
    requestKey: row.request_key,
    periodId: row.period_id,
    reservedMicros: money(row.reserved_micros),
    includedPortionMicros: money(row.included_portion_micros),
    topupPortionMicros: money(row.topup_portion_micros),
    consumedMicros: money(row.consumed_micros),
    status: row.status,
    reused,
  };
}

async function lockAccount(tx: Db, accountId: string): Promise<AccountLock> {
  const rows = await tx.query<{
    period_id: string | null;
    included_available_micros: string;
    topup_available_micros: string;
    reserved_micros: string;
  }>(`SELECT period_id::text AS period_id,
             included_available_micros::text AS included_available_micros,
             topup_available_micros::text AS topup_available_micros,
             reserved_micros::text AS reserved_micros
      FROM credit_accounts WHERE account_id = $1 FOR UPDATE`, [accountId]);
  const row = rows[0];
  if (!row) throw new Error('Credit account is missing.');
  return {
    periodId: row.period_id,
    included: money(row.included_available_micros),
    topup: money(row.topup_available_micros),
    reserved: money(row.reserved_micros),
  };
}

async function writeAccount(tx: Db, accountId: string, state: AccountLock): Promise<void> {
  await tx.query(`UPDATE credit_accounts
    SET included_available_micros = $2, topup_available_micros = $3, reserved_micros = $4,
        period_id = $5, updated_at = now()
    WHERE account_id = $1`, [accountId, state.included.toString(), state.topup.toString(), state.reserved.toString(), state.periodId]);
}

async function ledger(tx: Db, input: {
  accountId: string;
  kind: string;
  included: bigint;
  topup: bigint;
  reserved: bigint;
  key: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, string>;
}): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(`INSERT INTO credit_ledger (
      id, account_id, kind, included_delta_micros, topup_delta_micros, reserved_delta_micros,
      idempotency_key, reference_type, reference_id, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id::text AS id`, [
    randomUUID(), input.accountId, input.kind, input.included.toString(), input.topup.toString(), input.reserved.toString(),
    input.key, input.referenceType ?? null, input.referenceId ?? null, JSON.stringify(input.metadata ?? {}),
  ]);
  return rows.length > 0;
}

async function loadReservation(tx: Db, requestKey: string): Promise<ReservationRow | null> {
  const rows = await tx.query<ReservationRow>(`SELECT id::text, account_id::text, request_key, period_id::text,
      reserved_micros::text, included_portion_micros::text, topup_portion_micros::text,
      consumed_micros::text, status
    FROM credit_reservations WHERE request_key = $1 FOR UPDATE`, [requestKey]);
  return rows[0] ?? null;
}

export async function ensureCreditAccount(db: Db, accountId: string): Promise<void> {
  await db.query(`INSERT INTO credit_accounts (account_id) VALUES ($1) ON CONFLICT DO NOTHING`, [accountId]);
}

export async function balances(db: Db, accountId: string): Promise<{ included: bigint; topup: bigint; reserved: bigint; periodId: string | null }> {
  const rows = await db.query<{ included: string; topup: string; reserved: string; period_id: string | null }>(
    `SELECT included_available_micros::text AS included, topup_available_micros::text AS topup,
            reserved_micros::text AS reserved, period_id::text AS period_id
     FROM credit_accounts WHERE account_id = $1`, [accountId]);
  const row = rows[0];
  if (!row) throw new Error('Credit account is missing.');
  return { included: money(row.included), topup: money(row.topup), reserved: money(row.reserved), periodId: row.period_id };
}

/** Sum of ledger deltas. Tests use this to prove the cached balance is not the source of truth. */
export async function ledgerTotals(db: Db, accountId: string): Promise<{ included: bigint; topup: bigint; reserved: bigint }> {
  const rows = await db.query<{ included: string; topup: string; reserved: string }>(
    `SELECT COALESCE(SUM(included_delta_micros), 0)::text AS included,
            COALESCE(SUM(topup_delta_micros), 0)::text AS topup,
            COALESCE(SUM(reserved_delta_micros), 0)::text AS reserved
     FROM credit_ledger WHERE account_id = $1`, [accountId]);
  return { included: money(rows[0].included), topup: money(rows[0].topup), reserved: money(rows[0].reserved) };
}

export async function allocateIncluded(db: Db, input: { accountId: string; periodId: string; amountMicros: bigint }): Promise<{ applied: boolean }> {
  if (input.amountMicros < 0n) throw new Error('Allowance cannot be negative.');
  return db.transaction(async tx => {
    const state = await lockAccount(tx, input.accountId);
    const applied = await ledger(tx, {
      accountId: input.accountId,
      kind: 'allocation',
      included: input.amountMicros,
      topup: 0n,
      reserved: 0n,
      key: `allocation:${input.periodId}`,
      referenceType: 'billing_period',
      referenceId: input.periodId,
    });
    if (!applied) return { applied: false };
    state.included += input.amountMicros;
    state.periodId = input.periodId;
    await writeAccount(tx, input.accountId, state);
    return { applied: true };
  });
}

export async function expireIncluded(db: Db, input: { accountId: string; periodId: string }): Promise<{ expiredMicros: bigint }> {
  return db.transaction(tx => expireIncludedLocked(tx, input.accountId, input.periodId));
}

async function expireIncludedLocked(tx: Db, accountId: string, periodId: string): Promise<{ expiredMicros: bigint }> {
  const state = await lockAccount(tx, accountId);
  const amount = state.included;
  const applied = await ledger(tx, {
    accountId,
    kind: 'expiry',
    included: -amount,
    topup: 0n,
    reserved: 0n,
    key: `expiry:${periodId}`,
    referenceType: 'billing_period',
    referenceId: periodId,
    metadata: { expiredMicros: amount.toString() },
  });
  if (!applied) return { expiredMicros: 0n };
  state.included = 0n;
  await writeAccount(tx, accountId, state);
  return { expiredMicros: amount };
}

export async function openAllowancePeriod(db: Db, input: { accountId: string; previousPeriodId: string | null; periodId: string; amountMicros: bigint }): Promise<void> {
  await db.transaction(async tx => {
    if (input.previousPeriodId) await expireIncludedLocked(tx, input.accountId, input.previousPeriodId);
    const state = await lockAccount(tx, input.accountId);
    const applied = await ledger(tx, {
      accountId: input.accountId,
      kind: 'allocation',
      included: input.amountMicros,
      topup: 0n,
      reserved: 0n,
      key: `allocation:${input.periodId}`,
      referenceType: 'billing_period',
      referenceId: input.periodId,
    });
    if (!applied) return;
    state.included += input.amountMicros;
    state.periodId = input.periodId;
    await writeAccount(tx, input.accountId, state);
  });
}

export async function grantTopup(db: Db, input: { accountId: string; paymentId: string; amountMicros: bigint }): Promise<{ applied: boolean }> {
  if (input.amountMicros <= 0n) throw new Error('Top-up amount must be positive.');
  return db.transaction(async tx => {
    const state = await lockAccount(tx, input.accountId);
    const applied = await ledger(tx, {
      accountId: input.accountId,
      kind: 'topup',
      included: 0n,
      topup: input.amountMicros,
      reserved: 0n,
      key: `topup:${input.paymentId}`,
      referenceType: 'payment',
      referenceId: input.paymentId,
    });
    if (!applied) return { applied: false };
    state.topup += input.amountMicros;
    await writeAccount(tx, input.accountId, state);
    return { applied: true };
  });
}

export async function adjustCredits(db: Db, input: {
  accountId: string;
  includedDelta: bigint;
  topupDelta: bigint;
  idempotencyKey: string;
  reason: string;
  actorUserId: string;
}): Promise<{ ok: true } | LedgerFailure> {
  return db.transaction(async tx => {
    const state = await lockAccount(tx, input.accountId);
    if (state.included + input.includedDelta < 0n || state.topup + input.topupDelta < 0n) {
      return { ok: false, code: 'insufficient_credits', error: 'That adjustment would make a balance negative.' };
    }
    const applied = await ledger(tx, {
      accountId: input.accountId,
      kind: 'adjustment',
      included: input.includedDelta,
      topup: input.topupDelta,
      reserved: 0n,
      key: `adjustment:${input.idempotencyKey}`,
      metadata: { reason: input.reason, actorUserId: input.actorUserId },
    });
    if (applied) {
      state.included += input.includedDelta;
      state.topup += input.topupDelta;
      await writeAccount(tx, input.accountId, state);
      await tx.query(`INSERT INTO admin_audit_logs (id, actor_user_id, action, target, metadata)
        VALUES ($1, $2, 'credit.adjust', $3, $4::jsonb)`, [
        randomUUID(), input.actorUserId, input.accountId,
        JSON.stringify({ includedDelta: input.includedDelta.toString(), topupDelta: input.topupDelta.toString(), reason: input.reason, idempotencyKey: input.idempotencyKey }),
      ]);
    }
    return { ok: true };
  });
}

export async function reserveCredits(db: Db, input: {
  accountId: string;
  requestKey: string;
  amountMicros: bigint;
  maxConcurrent: number;
}): Promise<{ ok: true; reservation: Reservation } | LedgerFailure> {
  if (input.amountMicros <= 0n) throw new Error('Reservation amount must be positive.');
  return db.transaction(async tx => {
    await lockAccount(tx, input.accountId);
    const existing = await loadReservation(tx, input.requestKey);
    if (existing) {
      if (existing.account_id !== input.accountId) return { ok: false, code: 'missing', error: 'That credit reservation does not exist.' };
      return { ok: true, reservation: mapReservation(existing, true) };
    }
    const held = await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM credit_reservations WHERE account_id = $1 AND status = 'held'`, [input.accountId]);
    if (Number(held[0].count) >= input.maxConcurrent) {
      return { ok: false, code: 'too_many_requests', error: 'Too many platform requests are already running.' };
    }
    const state = await lockAccount(tx, input.accountId);
    if (state.included + state.topup < input.amountMicros) {
      return { ok: false, code: 'insufficient_credits', error: 'Platform credits are not enough for this request.' };
    }
    const includedPortion = state.included >= input.amountMicros ? input.amountMicros : state.included;
    const topupPortion = input.amountMicros - includedPortion;
    state.included -= includedPortion;
    state.topup -= topupPortion;
    state.reserved += input.amountMicros;
    const id = randomUUID();
    await writeAccount(tx, input.accountId, state);
    await tx.query(`INSERT INTO credit_reservations (
        id, account_id, request_key, period_id, reserved_micros, included_portion_micros, topup_portion_micros, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'held')`, [
      id, input.accountId, input.requestKey, state.periodId, input.amountMicros.toString(), includedPortion.toString(), topupPortion.toString(),
    ]);
    await ledger(tx, {
      accountId: input.accountId,
      kind: 'reserve',
      included: -includedPortion,
      topup: -topupPortion,
      reserved: input.amountMicros,
      key: `reserve:${input.requestKey}`,
      referenceType: 'reservation',
      referenceId: id,
    });
    const stored = await loadReservation(tx, input.requestKey);
    if (!stored) throw new Error('Reservation disappeared inside its transaction.');
    return { ok: true, reservation: mapReservation(stored, false) };
  });
}

async function finishReservation(tx: Db, input: { accountId: string; requestKey: string; billedMicros: bigint | null; release: boolean }): Promise<{ ok: true; reservation: Reservation; expiredIncludedMicros: bigint; billedMicros: bigint; capped: boolean } | LedgerFailure> {
  const state = await lockAccount(tx, input.accountId);
  const row = await loadReservation(tx, input.requestKey);
  if (!row || row.account_id !== input.accountId) return { ok: false, code: 'missing', error: 'That credit reservation does not exist.' };
  const current = mapReservation(row, false);
  if (current.status !== 'held') return { ok: true, reservation: current, expiredIncludedMicros: 0n, billedMicros: current.consumedMicros, capped: false };
  const requested = input.release || input.billedMicros === null ? 0n : input.billedMicros;
  if (requested < 0n) throw new Error('Billed amount cannot be negative.');
  const billed = requested > current.reservedMicros ? current.reservedMicros : requested;
  const capped = requested > current.reservedMicros;
  const consumeIncluded = billed > current.includedPortionMicros ? current.includedPortionMicros : billed;
  const consumeTopup = billed - consumeIncluded;
  const returnIncluded = current.includedPortionMicros - consumeIncluded;
  const returnTopup = current.topupPortionMicros - consumeTopup;
  const periodCurrent = state.periodId === current.periodId;
  const giveIncluded = periodCurrent ? returnIncluded : 0n;
  const expiredIncluded = periodCurrent ? 0n : returnIncluded;
  state.included += giveIncluded;
  state.topup += returnTopup;
  state.reserved -= current.reservedMicros;
  await writeAccount(tx, input.accountId, state);
  const status = input.release ? 'released' : 'settled';
  await tx.query(`UPDATE credit_reservations
    SET status = $2, consumed_micros = $3, settled_at = now()
    WHERE id = $1`, [current.id, status, billed.toString()]);
  await ledger(tx, {
    accountId: input.accountId,
    kind: status,
    included: giveIncluded,
    topup: returnTopup,
    reserved: -current.reservedMicros,
    key: `${status}:${input.requestKey}`,
    referenceType: 'reservation',
    referenceId: current.id,
    metadata: {
      billedMicros: billed.toString(),
      expiredIncludedMicros: expiredIncluded.toString(),
      capped: capped ? 'true' : 'false',
    },
  });
  const stored = await loadReservation(tx, input.requestKey);
  if (!stored) throw new Error('Reservation disappeared inside its transaction.');
  return { ok: true, reservation: mapReservation(stored, false), expiredIncludedMicros: expiredIncluded, billedMicros: billed, capped };
}

export async function settleReservation(db: Db, input: { accountId: string; requestKey: string; billedMicros: bigint }) {
  return db.transaction(tx => finishReservation(tx, { ...input, release: false }));
}

export async function releaseReservation(db: Db, input: { accountId: string; requestKey: string }) {
  return db.transaction(tx => finishReservation(tx, { ...input, billedMicros: null, release: true }));
}

/** Releases holds older than the gateway timeout so a crashed request cannot keep credits reserved. */
export async function releaseStaleReservations(db: Db, minutes = 15): Promise<number> {
  const rows = await db.query<{ account_id: string; request_key: string }>(
    `SELECT account_id::text, request_key FROM credit_reservations
     WHERE status = 'held' AND created_at < now() - make_interval(mins => $1::int)`, [minutes]);
  for (const row of rows) {
    await releaseReservation(db, { accountId: row.account_id, requestKey: row.request_key });
    await db.query(`UPDATE ai_requests SET status = 'released', error = 'stale', completed_at = now()
      WHERE status = 'reserved' AND reservation_id IN (SELECT id FROM credit_reservations WHERE request_key = $1)`, [row.request_key]);
  }
  return rows.length;
}
