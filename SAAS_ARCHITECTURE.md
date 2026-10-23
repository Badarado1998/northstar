# Northstar architecture

Northstar is a commercial fork of [PandaCode](https://github.com/aicodeking/pandacode). The desktop application remains Tauri 2, Rust, and the existing TypeScript UI. The hosted service is a separate Next.js application in `saas/`.

The installer product name and bundle identifier stay `PandaCode` and `ai.pandacode.desktop`. The window title and website use the temporary name Northstar from `brand.json`. Renaming the installer would also require the release scripts and the npx installer, which still look for `PandaCode` artifact names.

## Existing desktop architecture

A user message in the composer goes through `src/bridge.ts` into a Tauri command in `src-tauri/src/lib.rs`. `providers.rs` starts the selected coding CLI on the local machine and streams its events back to the window. Projects, sessions, messages, teams, and turn diffs stay in the local SQLite database opened by `storage.rs`. Provider API keys that the original app already stored stay in the operating-system keychain through `secret_store.rs`.

There is no account in that path. Claude Code, Codex, Copilot, Kimi, OpenCode, GLM, MiMo, ACP agents, Pi, Muse, DeepSeek, Command Code, and Cline keep authenticating as they do today. Those processes are not proxied and are not billed.

## Target split

The computer keeps project files, Git, terminals, previews, local servers, and local agent processes.

The hosted service owns:

- accounts, email verification, password reset, and device sessions
- subscription plans and Paystack checkout
- the credit ledger for platform-funded model calls
- the OpenAI and Anthropic gateway
- the admin pages

The desktop app calls that service only from `src-tauri/src/saas.rs`. The webview receives account labels and credit totals. The refresh token is stored as JSON in the keychain under service `ai.pandacode.desktop`, account `saas.session`.

## What stayed, what was added

Unchanged: local agent execution, teams, Git, worktrees, terminal, browser preview, bots, cloud sandboxes, local SQLite, and the existing provider settings.

Added: `saas/` (Next.js, PostgreSQL schema, ledger, Paystack, gateway, website, admin JSON views) and the desktop Account & billing settings section.

Not replaced: the Astro site in `website/` is still the upstream PandaCode site and still describes that project as having no account. The commercial site is `saas/`.

## Authentication

Web sign-in sets an HttpOnly `ns_session` cookie for 14 days. Passwords are scrypt hashes.

Desktop sign-in is a device code. The app asks `POST /api/auth/device/start`, opens the system browser at `/device?code=...`, and polls `POST /api/auth/device/token`. Approval requires a verified email. The free plan allows one active device; Pro allows two; Pro Plus three; Business ten. Those numbers are columns on `subscription_plans`, not constants in the desktop app.

Access tokens last 15 minutes. Refresh rotates the refresh token immediately. If the new token cannot be written to the keychain, the local session is cleared and the person must sign in again. There is no grace window for the previous refresh token.

Google sign-in is not implemented. `oauth_states` exists for a later PKCE flow. No OAuth client secret is shipped in the desktop app.

## Payments

Checkout amounts are read from `subscription_plans` or `topup_packages` on the server. Paystack is initialized with that amount. A browser return does not grant credits. `charge.success` is accepted only after HMAC-SHA512 verification of the raw body and a second call to Paystack's verify API. `applyVerifiedCharge` ignores a reference that was already paid.

Recurring billing is used only when a plan has a Paystack plan code. Otherwise checkout is a one-time charge and renewal is a new checkout. Failed subscription charges are marked `past_due` when the webhook reference matches a checkout. Paystack's disable call needs an email token this service does not store, so cancellation sets `cancel_at_period_end` locally and tells the customer to disable a Paystack-managed plan in the Paystack dashboard.

## AI metering

Platform credits are integer USD micros (`1_000_000` = $1). Included allowance and purchased top-ups are separate ledger buckets. A request reserves the estimated maximum, calls the provider, and settles the reported usage. If the provider omits usage, the reservation is released and nothing is billed. See `AI_BILLING_DESIGN.md`.

Customer-owned CLI subscriptions and keys saved in the existing provider settings do not pass through this ledger.

## Security boundary

A modified desktop build can skip the settings UI. It cannot increase `credit_accounts`, because those balances move only inside PostgreSQL transactions that recompute from `credit_ledger`. Provider secrets are read on the server from `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or a ciphertext written with `SECRETS_KEY`. The admin API never returns the key.

## Distribution

`brand.json` `updateEndpoint` is `https://updates.northstar.invalid/desktop/latest.json`, and `tauri.conf.json` points at the same URL so this fork does not install upstream PandaCode. The minisign public key in the config is still the upstream key. It must be replaced before that host serves updates. Download URLs in `brand.json` are empty, so the website shows "Not published" instead of linking upstream installers as Northstar builds.

## Known limits

- The gateway performs one chat completion, waits up to 55 seconds, and returns JSON. It does not stream tokens to the desktop, and it does not run a tool loop over a repository.
- Business memberships do not spend the owner's credit balance.
- Models are seeded disabled. An administrator must enable a provider and supply a key before a completion works.
- Windows and macOS packages were not built in this change.
- The updater public key is not yet a Northstar key.
