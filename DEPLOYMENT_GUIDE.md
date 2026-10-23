# Deployment guide

The hosted app is the Next.js 15 service in `saas/`. Deploy that directory to Vercel. Set `apiBaseUrl` and `websiteUrl` in both brand files to the deployed origin before building the desktop app.

The website reads `saas/brand.json`. The desktop app reads the copy at the repository root. Those two files are kept identical; `tests/open-source.test.mjs` fails if they diverge. A Vercel project whose root is `saas/` will not see the parent file.

No VPS and no Docker setup is required.

## Services

- Vercel project rooted at `saas/`
- Neon PostgreSQL. Set `DATABASE_URL` to the pooled connection string. The client uses SSL unless the host is localhost or `127.0.0.1`.
- Paystack. Set `PAYSTACK_SECRET_KEY`. Register the webhook `https://<APP_URL>/api/webhooks/paystack`.
- Optional Resend. Set `RESEND_API_KEY` and `MAIL_FROM`, or verification links are only returned in development responses and server logs.

`getDb()` applies `schema.sql` on first use. `npm run db:migrate` does the same. The schema uses `CREATE TABLE IF NOT EXISTS` and seed `ON CONFLICT DO NOTHING`. It does not drop columns.

## Environment

Copy the root `.env.example` into `saas/.env` for local development and into the Vercel project for production. Required before a real customer can pay and call a model:

- `DATABASE_URL`
- `APP_URL` (the public https origin)
- `SECRETS_KEY` (32 bytes, base64) before storing a provider key in the database
- `PAYSTACK_SECRET_KEY`
- `CRON_SECRET`
- `ADMIN_EMAIL`
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, and the matching provider enabled in `/admin`

`NODE_ENV=production` stops registration from returning a verification URL in the JSON body.

## Cron

`saas/vercel.json` schedules `GET /api/cron/billing` daily at 02:15 UTC. The handler accepts Vercel's `Authorization: Bearer $CRON_SECRET` and a manual `x-cron-secret` header. The job closes expired included allowances and releases reservations older than 15 minutes.

## Paystack

Create plan codes in Paystack only if the plan amount matches the database price. Put the code on the plan row. A mismatch is worse than a one-time checkout, because Paystack would charge its plan amount. Leave the code empty to use manual renewal.

Webhook processing stores the event id first. A duplicate delivery returns success and does not grant credits again. `charge.success` is verified with the Paystack API before the ledger changes.

## First administrator

Sign up as `ADMIN_EMAIL`, verify the email, sign in, and choose "Become first administrator" on `/admin`. Later admins are inserted into `platform_admins`. The bootstrap route refuses once any admin exists.

## What this host cannot do

Do not send a multi-minute coding-agent session through this function. The gateway is one completion with a 55-second abort. Desktop projects are not uploaded.

The Astro site in `website/` is not this deployment.
