# Security model (OWASP-aligned)

This service is designed so **payment and credits are decided on the server**, not in the browser or desktop app.

## Payments (Paystack)

| Control | Implementation |
| --- | --- |
| Webhook authenticity | HMAC-SHA512 over the **raw body** with `PAYSTACK_SECRET_KEY`; compared with **timing-safe** hex decode |
| No trust in redirect | Credits are granted only after **Paystack verify API** + `applyVerifiedCharge` |
| Amount tampering | Verified amount and currency must match the **checkout_sessions** row locked with `FOR UPDATE` |
| Idempotency | `payment_webhook_events (provider, event_id)` and `payments.provider_reference` uniqueness |
| Reference namespace | Only references matching `ns_<32 hex>` are accepted from webhooks |
| Mismatch audit | Failed or mismatched charges write `admin_audit_logs` with `payment.rejected` |
| Disputes | `charge.dispute.create` sets `accounts.billing_hold`, blocking checkout and platform models |
| Checkout abuse | Rate limit per account; server sets callback URL to `APP_URL/account/billing` only |
| Secret storage | `PAYSTACK_SECRET_KEY` only in Vercel/env — never in the desktop app |

## Authentication

- Passwords: **scrypt** (N=16384, r=8, p=1), never stored in plain text
- Login timing: unknown emails still run scrypt against a **dummy hash**
- Sessions: **HttpOnly** cookie, **SameSite=Strict** in production, **Secure** in production
- Desktop: refresh token in OS keychain; access token 15 minutes; refresh rotation
- Device flow: rate limits on start, poll, and refresh by IP
- Registration/login/forgot: rate limits by email

## API

- **CSRF**: cookie-authenticated `POST`/`DELETE` require matching `Origin` or `Referer` to `APP_URL` (desktop **Bearer** exempt)
- **Body size**: JSON capped at 64 KiB; webhooks at 256 KiB
- **Rate limits**: checkout, admin, bad webhook signatures, auth endpoints
- **Errors**: generic 500 message; no stack traces to clients
- **Headers**: `HSTS` (production), `CSP`, `X-Frame-Options: DENY`, `no-store` on API responses

## Credits and AI

- Balances from **append-only ledger**; reservations use row locks
- Client cannot set token counts or prices
- Gateway requires verified email, active subscription, model allowlist, and sufficient reserved micros

## Operations

- Rotate `CRON_SECRET`, `SECRETS_KEY`, and Paystack keys on a schedule
- Use **live** vs **test** Paystack keys consistently across env and dashboard webhooks
- Restrict Neon credentials to Vercel only; enable IP allowlisting if Neon offers it
- Review `admin_audit_logs` and failed `payments` rows regularly

## What you must still do manually

- Enable **WAF / bot protection** on Vercel for production if available on your plan
- Configure Paystack dashboard IP allowlisting if Paystack supports it for your account
- Run periodic dependency audits (`npm audit`) and apply patches
- Never commit `.env`, Paystack keys, or minisign **private** update keys
