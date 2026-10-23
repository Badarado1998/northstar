# Implementation plan

Status after the foundation pass. Items marked done have code and, where noted, tests. Items marked open are not claimed as finished.

## Stage 1 — Repository assessment

Done. The desktop path is Tauri commands to local CLIs and SQLite. The license is the PandaCode License: MIT plus a visible fork notice and link to https://github.com/aicodeking/pandacode. That notice is in the README, About, and the website licenses page.

## Stage 2 — SaaS backend

Done in `saas/`:

- PostgreSQL schema in `saas/src/lib/schema.sql`, applied on startup and by `npm run db:migrate`
- scrypt passwords, email verification, password reset, device-code desktop login, refresh rotation, device limit
- ledger, plans, Paystack verify, credit top-ups, duplicate-charge protection
- tests in `saas/tests/` against PGlite

Open: Google OAuth. The table exists; there is no route.

## Stage 3 — Desktop integration

Done:

- `src-tauri/src/saas.rs` stores the refresh token in the OS keychain and calls the hosted API
- Settings → Account & billing can sign in, show balances, open checkout, and send one platform completion
- the browser preview refuses those commands except for a signed-out status

Open: the account panel does not draw charts. Usage history is on the website account page.

## Stage 4 — Gateway

Done for direct OpenAI-compatible and Anthropic chat completions, with reservation, settle, and release. Missing provider usage is not billed. Tests cover a billed SSE response, an idempotent replay, and a response without usage.

Open: streaming to the desktop, tool-using local agents that call the gateway per turn, and any CLI that cannot report tokens. Those stay customer-owned.

## Stage 5 — Payments

Done: initialize, verify, webhook signature, idempotent event id, one-time subscription activation, renewal allocation, top-up, dispute hold.

Open: storing Paystack's email token and calling subscription disable. Cancellation is local, plus a written instruction when a Paystack plan code is present. Automatic retries of failed charges are not implemented; the customer renews manually.

## Stage 6 — Admin

Done as signed-in JSON pages at `/admin` for overview, users, plans, providers, and finance. The first administrator is created by `POST /api/admin/bootstrap` when `platform_admins` is empty and the session email equals `ADMIN_EMAIL`.

Open: a richer editing UI. Plan, provider, credit, and suspend actions exist as API routes and are not all given forms.

## Stage 7 — Distribution

Prepared, not shipped:

- `brand.json` holds the temporary name, colors, URLs, and empty download links
- the updater endpoint no longer points at upstream GitHub
- the signing public key is still upstream and must be rotated before a public update feed

Open: signed Windows and macOS installers, notarization, and a real update host. See `DESKTOP_RELEASE_GUIDE.md`.

## Stage 8 — Verification

Done for the ledger and billing tests in `saas/tests/`.

Open: a full desktop run against Neon and Paystack, installer builds, and the root `npm test` suite after `npm ci` and a frontend build. Bundle tests need `dist/`.

## Acceptance still outstanding

A paying customer can complete the path only after `DATABASE_URL`, Paystack, a provider key, and an enabled model are configured. Until download URLs are filled, the website does not offer an installer.
