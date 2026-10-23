# Provider compatibility

PandaCode launches coding agents as local programs. Those programs are not the same thing as a model API, and this fork does not resell them.

## Platform gateway

Supported when an administrator enables the provider and a key is available:

- OpenAI chat completions, including the seeded GPT-4.1 mini, GPT-4.1 nano, and GPT-5 mini ids
- Anthropic messages, including the seeded Claude Haiku 5.5 and Claude Sonnet 5.5 ids
- a provider row with kind `openai_compatible` can be added in the database; none is seeded

The server holds the key. The desktop request is one non-tool completion. Usage is taken from the provider's stream usage fields. If those fields are absent, the call is not billed.

## Customer-owned local agents

These stay on the existing path in `providers.rs`. They use the customer's own login or key. Platform credits are not consumed, and their traffic is not intercepted.

| Agent | Authentication today | Gateway |
| --- | --- | --- |
| Claude Code | Customer CLI login or a key the customer saved | Not routed. Consumer subscriptions are not resold. |
| Codex | Customer CLI login | Not routed. |
| GitHub Copilot CLI | Customer GitHub login | Not routed. |
| Kimi, OpenCode, GLM, MiMo, DeepSeek, Command Code | Customer key or endpoint in the existing settings | Not routed. Keys remain in the local keychain. |
| ACP agents, Pi, omp, Muse, Cline | Their own local protocol | Not routed. |

Bring-your-own-key for those CLIs is the original settings screen. Do not paste those keys into the hosted admin provider form. That form is only for the platform's own OpenAI and Anthropic keys.

## Terms

Do not point a local CLI at this gateway by rewriting its auth file. The gateway speaks chat-completions and Anthropic messages, not those CLIs' session protocols, and several of those products prohibit sharing a subscription. A local agent that should spend platform credits would have to call `POST /api/v1/ai/chat` itself, once per model turn, with an access token. That loop is not built.

## Limits that follow from the host

Vercel functions are a poor place for a multi-minute agent loop. The current call aborts at 55 seconds and caps output at 4,096 tokens. A longer agent belongs on the customer's machine, calling a supported API only if that API's terms and this ledger both allow it.
