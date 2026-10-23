# Database schema

The hosted schema is `saas/src/lib/schema.sql`. The desktop SQLite database is unchanged and is not copied to the cloud.

Money is integer. Subscription prices are currency subunits (`price_subunits`, 100 = 1 unit). AI credits are USD micros (`1_000_000` = $1). JavaScript numbers are not used for balances; the TypeScript code uses `bigint`.

## Identity

- `users` — email, scrypt password hash, status, email verification, deletion timestamp
- `accounts` — billing owner, `billing_hold`
- `memberships` — user, account, role. Adding a member does not share the credit balance
- `platform_admins` — users allowed to call `/api/admin/*` after the one-time bootstrap
- `devices` — desktop installs, revoked timestamp
- `desktop_sessions` — hashed refresh and access tokens, expiry, revocation
- `web_sessions` — hashed cookie token
- `email_tokens` — verification and reset
- `device_authorizations` — hashed device code, user code, expiry
- `oauth_states` — reserved for a future Google PKCE flow; unused

## Billing

- `subscription_plans` — price, interval, included allowance, trial allowance, device and team limits, concurrency, per-request cap, top-up and BYOK flags, `model_access` (`all` or `listed`), optional Paystack plan code
- `plan_models` — models allowed when `model_access` is `listed`
- `subscriptions` — one row per account, status, period, `cancel_at_period_end`, optional provider subscription code
- `subscription_events` — status history
- `billing_periods` — included micros for one period and a unique `source_key` so the same payment cannot open two periods
- `topup_packages` — price, credit micros, optional `expires_in_days`
- `checkout_sessions` — server-priced checkout, status default `pending`, provider reference
- `payments` — verified charges
- `payment_webhook_events` — unique `(provider, event_id)`

## Credits

- `credit_accounts` — cached included, top-up, and reserved micros. Tests require this cache to equal the ledger sum
- `credit_ledger` — append-only deltas with a unique `idempotency_key`
- `credit_reservations` — hold for one in-flight request
- `credit_topups` — purchased credit grants

Included credits are spent before top-ups. Unused included micros return to the included bucket only when the reservation's period is still the open period. A renewal expires leftover included credit. Top-ups are returned even after renewal. A zero estimate still reserves 1 micro because `reserved_micros` must be greater than zero; settlement returns what was not billed.

## Models

- `ai_providers` — kind, base URL, `secret_env`, optional ciphertext, enabled flag. Seeded disabled
- `ai_models` — API model name, enabled flag, optional max input tokens
- `model_prices` — input, output, cache read, cache write, micros per million tokens, `markup_bps` (`10000` = 1.0x). A new row is inserted when markup changes; the newest `effective_from` wins
- `ai_requests` — unique `(account_id, idempotency_key)`, status, reservation
- `ai_usage_records` — provider-reported tokens, provider cost, billed micros

## Operations

- `admin_audit_logs` — actor, action, target
- `application_releases` — reserved for a later release catalog. The desktop updater currently uses the static endpoint in `tauri.conf.json`
- `system_settings` — includes `low_credit_bps` (seeded `2000`, meaning 20 percent)
- `rate_limits` — bucket counter for request limits

Seeded plans: Free (₦0, $1 trial, 7 days, 1 device), Pro (₦25,000, $15 allowance, 2 devices), Pro Plus (₦50,000, $40, 3 devices), Business (₦150,000, $120, 10 devices, 25 members), Enterprise (not self-serve). Top-ups: ₦8,000 → $5 and ₦20,000 → $15, with no expiry unless `expires_in_days` is set. Prices are rows and can be edited. `ON CONFLICT DO NOTHING` means a later seed does not overwrite an administrator's edits.
