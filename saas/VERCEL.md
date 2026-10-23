# Deploy to Vercel (`app.bada.com.ng`)

1. Import **https://github.com/Badarado1998/northstar** in Vercel.
2. Set **Root Directory** to **`saas`** (not the repo root).
3. Framework preset: **Next.js** (defaults are fine).
4. Environment variables — copy from `.env.example` at repo root into Vercel **Production** (and Preview if you want):

   | Variable | Production value |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled Postgres URL |
   | `APP_URL` | `https://app.bada.com.ng` |
   | `NODE_ENV` | `production` |
   | `ADMIN_EMAIL` | your admin email |
   | `CRON_SECRET` | long random string |
   | `SECRETS_KEY` | base64 32-byte key |
   | `PAYSTACK_SECRET_KEY` | Paystack secret (test or live) |
   | `RESEND_API_KEY` / `MAIL_FROM` | optional but needed for email in prod |
   | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | when enabling platform models |

5. Deploy. Then **Settings → Domains** → add **`app.bada.com.ng`**.
6. At your DNS host for `bada.com.ng`, add:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `app` | `cname.vercel-dns.com` |

   (Use the exact target Vercel shows if it differs.)

7. Paystack webhook: `https://app.bada.com.ng/api/webhooks/paystack`

**Local SaaS dev** still uses `saas/.env` with `APP_URL=http://127.0.0.1:3000`. **`brand.json`** points the **desktop app** at `https://app.bada.com.ng` for account sign-in when you build/run against production.
