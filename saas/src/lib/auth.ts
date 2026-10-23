import { randomUUID } from 'node:crypto';
import { startTrial } from './billing';
import type { Db } from './db';
import type { Mailer } from './mailer';
import { DUMMY_PASSWORD_HASH, hashPassword, passwordError, verifyPassword } from './passwords';
import { allowRate } from './rate-limit';
import { hashToken, newToken, normalizeEmail, userCode } from './tokens';

export interface Principal {
  userId: string;
  accountId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  status: string;
  deviceId: string | null;
}

export class ServiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const ACCESS_SECONDS = 15 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;
const WEB_SECONDS = 14 * 24 * 60 * 60;

async function personalAccount(db: Db, userId: string): Promise<string> {
  const rows = await db.query<{ account_id: string }>(`SELECT m.account_id::text FROM memberships m
    JOIN accounts a ON a.id = m.account_id
    WHERE m.user_id = $1 AND m.role = 'owner' AND a.kind = 'personal'
    ORDER BY a.created_at LIMIT 1`, [userId]);
  if (!rows[0]) throw new ServiceError(404, 'Account not found.');
  return rows[0].account_id;
}

export async function registerUser(db: Db, mailer: Mailer, appUrl: string, input: { email: string; password: string; name: string }): Promise<{ userId: string; verificationToken: string }> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new ServiceError(400, 'Enter a valid email address.');
  const passwordProblem = passwordError(input.password, email);
  if (passwordProblem) throw new ServiceError(400, passwordProblem);
  if (!await allowRate(db, `register:${email}`, 5, 3600)) throw new ServiceError(429, 'Too many registration attempts. Try again later.');
  const userId = randomUUID();
  const accountId = randomUUID();
  const name = input.name.trim().slice(0, 80) || email.split('@')[0];
  try {
    await db.transaction(async tx => {
      await tx.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)`, [userId, email, name, await hashPassword(input.password)]);
      await tx.query(`INSERT INTO accounts (id, name, kind, owner_user_id) VALUES ($1, $2, 'personal', $3)`, [accountId, name, userId]);
      await tx.query(`INSERT INTO memberships (account_id, user_id, role) VALUES ($1, $2, 'owner')`, [accountId, userId]);
    });
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && (error as { code: string }).code === '23505') {
      throw new ServiceError(409, 'If this email can be used, check your inbox for the next step.');
    }
    throw error;
  }
  await startTrial(db, accountId);
  const verificationToken = newToken();
  await db.query(`INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at) VALUES ($1, $2, 'verify', $3, now() + interval '24 hours')`, [randomUUID(), userId, hashToken(verificationToken)]);
  await mailer.send({ to: email, subject: 'Verify your email', text: `Confirm your account: ${appUrl}/verify-email?token=${verificationToken}` });
  return { userId, verificationToken };
}

export async function loginUser(db: Db, emailRaw: string, password: string): Promise<{ userId: string; sessionToken: string }> {
  const email = normalizeEmail(emailRaw);
  if (!await allowRate(db, `login:${email}`, 10, 900)) throw new ServiceError(429, 'Too many sign-in attempts. Try again later.');
  const rows = await db.query<{ id: string; password_hash: string | null; status: string }>(`SELECT id::text, password_hash, status FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`, [email]);
  const user = rows[0];
  const hash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  if (!user?.password_hash || !await verifyPassword(password, hash)) throw new ServiceError(401, 'Email or password is incorrect.');
  if (user.status !== 'active') throw new ServiceError(403, 'This account is not allowed to sign in.');
  const sessionToken = newToken();
  await db.query(`INSERT INTO web_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4::int))`, [randomUUID(), user.id, hashToken(sessionToken), WEB_SECONDS]);
  return { userId: user.id, sessionToken };
}

export async function logoutSession(db: Db, sessionToken: string): Promise<void> {
  await db.query(`UPDATE web_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [hashToken(sessionToken)]);
}

export async function principalFromWebToken(db: Db, sessionToken: string): Promise<Principal | null> {
  const rows = await db.query<{ user_id: string; email: string; name: string; email_verified_at: string | null; status: string }>(
    `SELECT u.id::text AS user_id, u.email, u.name, u.email_verified_at::text, u.status
     FROM web_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`, [hashToken(sessionToken)]);
  const row = rows[0];
  if (!row || row.status !== 'active') return null;
  return { userId: row.user_id, accountId: await personalAccount(db, row.user_id), email: row.email, name: row.name, emailVerified: Boolean(row.email_verified_at), status: row.status, deviceId: null };
}

export async function principalFromAccessToken(db: Db, accessToken: string): Promise<Principal | null> {
  const rows = await db.query<{ user_id: string; account_id: string; device_id: string; email: string; name: string; email_verified_at: string | null; status: string }>(
    `SELECT s.user_id::text, s.account_id::text, s.device_id::text, u.email, u.name, u.email_verified_at::text, u.status
     FROM desktop_sessions s JOIN users u ON u.id = s.user_id JOIN devices d ON d.id = s.device_id
     WHERE s.access_token_hash = $1 AND s.revoked_at IS NULL AND s.access_expires_at > now()
       AND d.revoked_at IS NULL AND u.deleted_at IS NULL`, [hashToken(accessToken)]);
  const row = rows[0];
  if (!row || row.status !== 'active') return null;
  await db.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [row.device_id]);
  return { userId: row.user_id, accountId: row.account_id, email: row.email, name: row.name, emailVerified: Boolean(row.email_verified_at), status: row.status, deviceId: row.device_id };
}

export async function verifyEmail(db: Db, token: string): Promise<void> {
  const rows = await db.query<{ id: string; user_id: string }>(`SELECT id::text, user_id::text FROM email_tokens
    WHERE token_hash = $1 AND purpose = 'verify' AND used_at IS NULL AND expires_at > now()`, [hashToken(token)]);
  const row = rows[0];
  if (!row) throw new ServiceError(400, 'This verification link is invalid or expired.');
  await db.transaction(async tx => {
    await tx.query(`UPDATE email_tokens SET used_at = now() WHERE id = $1`, [row.id]);
    await tx.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1`, [row.user_id]);
  });
}

export async function requestPasswordReset(db: Db, mailer: Mailer, appUrl: string, emailRaw: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  if (!await allowRate(db, `reset:${email}`, 5, 3600)) return;
  const users = await db.query<{ id: string }>(`SELECT id::text FROM users WHERE lower(email) = $1 AND deleted_at IS NULL AND status = 'active'`, [email]);
  if (!users[0]) return;
  const token = newToken();
  await db.query(`INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at) VALUES ($1, $2, 'reset', $3, now() + interval '30 minutes')`, [randomUUID(), users[0].id, hashToken(token)]);
  await mailer.send({ to: email, subject: 'Reset your password', text: `Reset your password: ${appUrl}/reset-password?token=${token}` });
}

export async function resetPassword(db: Db, token: string, password: string): Promise<void> {
  const rows = await db.query<{ id: string; user_id: string; email: string }>(`SELECT t.id::text, t.user_id::text, u.email
    FROM email_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = $1 AND t.purpose = 'reset' AND t.used_at IS NULL AND t.expires_at > now()`, [hashToken(token)]);
  const row = rows[0];
  if (!row) throw new ServiceError(400, 'This reset link is invalid or expired.');
  const problem = passwordError(password, row.email);
  if (problem) throw new ServiceError(400, problem);
  await db.transaction(async tx => {
    await tx.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [row.user_id, await hashPassword(password)]);
    await tx.query(`UPDATE email_tokens SET used_at = now() WHERE id = $1`, [row.id]);
    await tx.query(`UPDATE web_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
    await tx.query(`UPDATE desktop_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
  });
}

export async function startDeviceAuthorization(db: Db, input: { deviceName: string; platform: string; appVersion: string }, ip = 'unknown'): Promise<{ deviceCode: string; userCode: string; intervalSeconds: number; expiresIn: number }> {
  if (!await allowRate(db, `device:start:${ip}`, 20, 3600)) throw new ServiceError(429, 'Too many sign-in attempts. Try again later.');
  const deviceCode = newToken();
  const code = userCode();
  await db.query(`INSERT INTO device_authorizations (
      id, device_code_hash, user_code, status, device_name, platform, app_version, expires_at
    ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, now() + interval '15 minutes')`, [
    randomUUID(), hashToken(deviceCode), code, input.deviceName.slice(0, 80), input.platform.slice(0, 40), input.appVersion.slice(0, 40),
  ]);
  return { deviceCode, userCode: code, intervalSeconds: 5, expiresIn: 900 };
}

export async function approveDevice(db: Db, principal: Principal, code: string): Promise<void> {
  if (!principal.emailVerified) throw new ServiceError(403, 'Verify your email before linking a desktop app.');
  const rows = await db.query<{ id: string }>(`UPDATE device_authorizations
    SET status = 'approved', user_id = $2, account_id = $3
    WHERE user_code = $1 AND status = 'pending' AND expires_at > now()
    RETURNING id::text`, [code.trim().toUpperCase(), principal.userId, principal.accountId]);
  if (!rows[0]) throw new ServiceError(400, 'That device code is invalid or expired.');
}

export async function pollDevice(db: Db, deviceCode: string, ip = 'unknown'): Promise<{ status: 'pending' } | { status: 'approved'; refreshToken: string; accessToken: string; expiresIn: number; deviceId: string }> {
  if (!await allowRate(db, `device:poll:${ip}`, 120, 900)) throw new ServiceError(429, 'Too many sign-in checks. Try again later.');
  return db.transaction(async tx => {
    const rows = await tx.query<{
      id: string; status: string; user_id: string | null; account_id: string | null; device_name: string; platform: string; app_version: string;
    }>(`SELECT id::text, status, user_id::text, account_id::text, device_name, platform, app_version
        FROM device_authorizations WHERE device_code_hash = $1 FOR UPDATE`, [hashToken(deviceCode)]);
    const auth = rows[0];
    if (!auth) throw new ServiceError(400, 'This sign-in request is no longer valid.');
    if (auth.status === 'pending') return { status: 'pending' as const };
    if (auth.status !== 'approved' || !auth.user_id || !auth.account_id) throw new ServiceError(400, 'This sign-in request is no longer valid.');
    await tx.query(`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, [auth.account_id]);
    const plan = await tx.query<{ max_devices: number }>(`SELECT p.max_devices FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.account_id = $1`, [auth.account_id]);
    const active = await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM devices WHERE account_id = $1 AND revoked_at IS NULL`, [auth.account_id]);
    if (Number(active[0].count) >= (plan[0]?.max_devices ?? 1)) {
      await tx.query(`UPDATE device_authorizations SET status = 'denied' WHERE id = $1`, [auth.id]);
      throw new ServiceError(403, 'This account has reached its active device limit. Revoke a device, then sign in again.');
    }
    const deviceId = randomUUID();
    const refreshToken = newToken();
    const accessToken = newToken();
    await tx.query(`INSERT INTO devices (id, account_id, user_id, name, platform, app_version) VALUES ($1,$2,$3,$4,$5,$6)`, [deviceId, auth.account_id, auth.user_id, auth.device_name, auth.platform, auth.app_version]);
    await tx.query(`INSERT INTO desktop_sessions (
        id, device_id, user_id, account_id, refresh_token_hash, access_token_hash, access_expires_at, refresh_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7::int), now() + make_interval(secs => $8::int))`, [
      randomUUID(), deviceId, auth.user_id, auth.account_id, hashToken(refreshToken), hashToken(accessToken), ACCESS_SECONDS, REFRESH_SECONDS,
    ]);
    await tx.query(`UPDATE device_authorizations SET status = 'consumed', device_id = $2 WHERE id = $1`, [auth.id, deviceId]);
    return { status: 'approved' as const, refreshToken, accessToken, expiresIn: ACCESS_SECONDS, deviceId };
  });
}

export async function refreshDesktopSession(db: Db, refreshToken: string, ip = 'unknown'): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  if (!await allowRate(db, `device:refresh:${ip}`, 60, 900)) throw new ServiceError(429, 'Too many session refreshes. Try again later.');
  return db.transaction(async tx => {
    const rows = await tx.query<{ id: string }>(`SELECT id::text FROM desktop_sessions
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND refresh_expires_at > now()
      FOR UPDATE`, [hashToken(refreshToken)]);
    const row = rows[0];
    if (!row) throw new ServiceError(401, 'Sign in again.');
    const nextRefresh = newToken();
    const accessToken = newToken();
    await tx.query(`UPDATE desktop_sessions SET
        refresh_token_hash = $2,
        access_token_hash = $3,
        access_expires_at = now() + make_interval(secs => $4::int),
        refresh_expires_at = now() + make_interval(secs => $5::int)
      WHERE id = $1`, [row.id, hashToken(nextRefresh), hashToken(accessToken), ACCESS_SECONDS, REFRESH_SECONDS]);
    return { refreshToken: nextRefresh, accessToken, expiresIn: ACCESS_SECONDS };
  });
}

export async function revokeDevice(db: Db, principal: Principal, deviceId: string): Promise<void> {
  const rows = await db.query(`UPDATE devices SET revoked_at = now() WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL RETURNING id`, [deviceId, principal.accountId]);
  if (!rows.length) throw new ServiceError(404, 'That device is not active.');
  await db.query(`UPDATE desktop_sessions SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL`, [deviceId]);
}

export async function listDevices(db: Db, accountId: string) {
  return db.query<{ id: string; name: string; platform: string; app_version: string; last_seen_at: string; revoked_at: string | null }>(
    `SELECT id::text, name, platform, app_version, last_seen_at::text, revoked_at::text FROM devices WHERE account_id = $1 ORDER BY created_at DESC`, [accountId]);
}

export async function deleteAccount(db: Db, principal: Principal): Promise<void> {
  const deletedEmail = `deleted.${principal.userId}@users.invalid`;
  await db.transaction(async tx => {
    await tx.query(`UPDATE users SET email = $2, name = 'Deleted user', password_hash = NULL, google_sub = NULL, status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1`, [principal.userId, deletedEmail]);
    await tx.query(`UPDATE web_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [principal.userId]);
    await tx.query(`UPDATE desktop_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [principal.userId]);
    await tx.query(`UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [principal.userId]);
  });
}

export async function addMember(db: Db, principal: Principal, emailRaw: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const owners = await db.query(`SELECT 1 FROM memberships WHERE account_id = $1 AND user_id = $2 AND role = 'owner'`, [principal.accountId, principal.userId]);
  if (!owners.length) throw new ServiceError(403, 'Only the account owner can add members.');
  const plan = await db.query<{ max_team_members: number }>(`SELECT p.max_team_members FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.account_id = $1`, [principal.accountId]);
  const count = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM memberships WHERE account_id = $1`, [principal.accountId]);
  if (Number(count[0].count) >= (plan[0]?.max_team_members ?? 1)) throw new ServiceError(403, 'This plan has no free member seats.');
  const users = await db.query<{ id: string }>(`SELECT id::text FROM users WHERE lower(email) = $1 AND deleted_at IS NULL AND status = 'active'`, [email]);
  if (!users[0]) throw new ServiceError(404, 'That person needs an account before they can be added.');
  await db.query(`INSERT INTO memberships (account_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [principal.accountId, users[0].id]);
}
