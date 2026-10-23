const pages = {
  features: ['Features', 'Projects, tasks, Git, worktrees, terminals, diffs, and agent teams stay in the desktop app. The hosted service adds accounts, subscriptions, device limits, and metered platform models.'],
  models: ['Models', 'Platform models are the direct APIs an administrator enables: GPT-4.1 mini, GPT-4.1 nano, GPT-5 mini, Claude Haiku 5.5, and Claude Sonnet 5.5. Prices are stored per model and can be changed without a desktop release. Claude Code, Codex, Copilot, and the other local CLIs are not resold through this gateway.'],
  docs: ['Documentation', 'Create an account, verify your email, subscribe, then sign in from the desktop app under Settings → Account & billing. Platform completions call POST /api/v1/ai/chat with a desktop access token. Local agent runs do not call that endpoint and do not spend credits.'],
  faq: ['FAQ', 'Unused included credits expire at the end of the billing period. Purchased top-up credits stay until their own expiry, which is unset in the initial packages. A failed model response that does not report token usage is not billed. Changing the desktop app cannot raise your balance.'],
  support: ['Support', 'Write to the address in MAIL_FROM once email is configured. Until then, use the contact shown on your deployment. Do not send project source code.'],
  terms: ['Terms', 'The hosted service provides account, billing, and metered model access. Local project files are not uploaded except for the text you explicitly send in a platform-model request. Subscriptions renew only after a verified payment. This service is a fork of PandaCode and is provided as available software without a warranty beyond what a written customer agreement adds.'],
  privacy: ['Privacy', 'The desktop app stores projects, conversations, and settings locally. The service stores your account, device sessions, payment records, and token counts for platform-model requests. Prompt text is sent to the model provider and is not stored in the billing database. Provider API keys are encrypted when SECRETS_KEY is set and are never returned to the browser.'],
  licenses: ['Licenses', 'This is a fork of PandaCode, https://github.com/aicodeking/pandacode. The desktop application remains under the PandaCode License, which is the MIT License plus a requirement to keep that attribution visible. Third-party notices ship with the application and its dependencies.'],
} as const;

export function contentPage(id: keyof typeof pages) {
  const [title, body] = pages[id];
  return <main className="mx-auto max-w-3xl px-6 py-12"><h1 className="font-serif text-5xl">{title}</h1><p className="mt-4 text-lg leading-8 text-ink/80">{body}</p></main>;
}
