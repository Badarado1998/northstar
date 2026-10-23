# AI billing design

Platform-funded usage is the only usage this ledger bills. A local coding CLI, including one signed into the customer's own Claude, Codex, or Copilot subscription, does not create an `ai_requests` row.

## Units

Customer credits and provider cost are both USD micros. `saas/src/lib/money.ts` rounds half a micro away from zero with integer division. Markup is basis points on the price row. The seeded markup is `10000` (no markup over the published token prices stored in `model_prices`).

The subscription price is independent of the allowance. Pro costs ₦25,000 and includes $15 of platform usage. Spending the $15 does not cancel the subscription. Further hosted calls fail until a top-up or the next included grant.

## Request path

1. The desktop command `saas_complete` sends the typed prompt, a model id, and a new idempotency key. It does not send the workspace.
2. The server checks the access token, verified email, plan, model enablement, and billing hold.
3. Input size is estimated only to size the reservation. The bill uses provider-reported tokens.
4. `reserveCredits` locks the account, moves included micros first, then top-up micros, into `reserved`, and inserts a ledger row. A second concurrent reserve cannot overdraw. The plan's `max_concurrent_requests` is enforced in the same transaction.
5. The server calls OpenAI or Anthropic with `stream: true` and `stream_options.include_usage` where that provider supports it, and reads the body for up to 55 seconds.
6. If the HTTP call fails, times out, or the body has no usage object, the reservation is released and the request is `released`. The customer is not charged.
7. If usage is present, `priceUsage` computes provider cost and billed micros. `settleReservation` returns the unused part of the hold. Included remainder is returned only when the period id still matches; otherwise it is recorded as expired included usage and is not added back.
8. Replaying the same idempotency key after `settled` returns the stored usage and does not charge again. The replay response text is empty because prompt text is not stored.

## What is not billed

- provider errors and missing usage
- customer-owned API keys in the desktop keychain
- local agent transcripts
- a webhook that arrives twice (`payment_webhook_events` and the payment reference)
- a second allocation for the same billing `source_key`

Stale reservations older than 15 minutes are released by `POST` or `GET /api/cron/billing`.

## Seeded model prices

These are the public list prices stored with the schema, in USD per million tokens, before markup. They are data, not a promise that the provider still charges this:

| Model | Input | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| gpt-4.1-mini | $0.40 | $1.60 | $0.10 | $0 |
| gpt-4.1-nano | $0.10 | $0.40 | $0.025 | $0 |
| gpt-5-mini | $0.25 | $2.00 | $0.025 | $0 |
| claude-haiku-5-5 | $0.10 | $0.50 | $0.01 | $0.125 |
| claude-sonnet-5-5 | $2.00 | $10.00 | $0.10 | $2.50 |

Claude Haiku 5.5 refuses estimated prompts above 100,000 input tokens because a longer context uses a different published price. All five models are inserted disabled.

## Desktop behavior

`saas_complete` is one completion from the Account panel. It is not a project agent, it does not see files, and the UI says so. Token streaming back to the window is not implemented; the command returns after the provider finishes.
