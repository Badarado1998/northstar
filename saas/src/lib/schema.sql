CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  password_hash text,
  google_sub text,
  email_verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_active ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('personal', 'organization')),
  owner_user_id uuid NOT NULL REFERENCES users (id),
  billing_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  account_id uuid NOT NULL REFERENCES accounts (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'billing')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  user_id uuid NOT NULL REFERENCES users (id),
  name text NOT NULL,
  platform text NOT NULL,
  app_version text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS devices_account_active ON devices (account_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS desktop_sessions (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices (id),
  user_id uuid NOT NULL REFERENCES users (id),
  account_id uuid NOT NULL REFERENCES accounts (id),
  refresh_token_hash text NOT NULL UNIQUE,
  previous_refresh_hash text,
  previous_refresh_expires_at timestamptz,
  previous_refresh_used boolean NOT NULL DEFAULT false,
  access_token_hash text UNIQUE,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS desktop_sessions_user ON desktop_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS web_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_authorizations (
  id uuid PRIMARY KEY,
  device_code_hash text NOT NULL UNIQUE,
  user_code text NOT NULL UNIQUE,
  user_id uuid REFERENCES users (id),
  account_id uuid REFERENCES accounts (id),
  device_id uuid,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'consumed', 'expired')),
  device_name text NOT NULL,
  platform text NOT NULL,
  app_version text NOT NULL DEFAULT '',
  poll_interval_seconds integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  verifier text NOT NULL,
  redirect_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  currency text NOT NULL,
  price_subunits bigint NOT NULL CHECK (price_subunits >= 0),
  interval_days integer NOT NULL CHECK (interval_days > 0),
  included_allowance_micros bigint NOT NULL CHECK (included_allowance_micros >= 0),
  trial_allowance_micros bigint NOT NULL DEFAULT 0 CHECK (trial_allowance_micros >= 0),
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  max_devices integer NOT NULL CHECK (max_devices > 0),
  max_team_members integer NOT NULL CHECK (max_team_members > 0),
  max_concurrent_requests integer NOT NULL CHECK (max_concurrent_requests > 0),
  max_request_micros bigint NOT NULL CHECK (max_request_micros >= 0),
  allow_topups boolean NOT NULL DEFAULT false,
  allow_byok boolean NOT NULL DEFAULT true,
  self_serve boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  model_access text NOT NULL DEFAULT 'all' CHECK (model_access IN ('all', 'listed')),
  paystack_plan_code text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_models (
  plan_id text NOT NULL REFERENCES subscription_plans (id),
  model_id text NOT NULL,
  PRIMARY KEY (plan_id, model_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts (id),
  plan_id text NOT NULL REFERENCES subscription_plans (id),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  provider text,
  provider_customer_code text,
  provider_subscription_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES subscriptions (id),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_periods (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  subscription_id uuid NOT NULL REFERENCES subscriptions (id),
  plan_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  included_micros bigint NOT NULL CHECK (included_micros >= 0),
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  source_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_periods_account ON billing_periods (account_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS topup_packages (
  id text PRIMARY KEY,
  name text NOT NULL,
  currency text NOT NULL,
  price_subunits bigint NOT NULL CHECK (price_subunits > 0),
  credit_micros bigint NOT NULL CHECK (credit_micros > 0),
  expires_in_days integer,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  user_id uuid NOT NULL REFERENCES users (id),
  purpose text NOT NULL CHECK (purpose IN ('subscription', 'renewal', 'topup')),
  plan_id text REFERENCES subscription_plans (id),
  topup_package_id text REFERENCES topup_packages (id),
  amount_subunits bigint NOT NULL CHECK (amount_subunits >= 0),
  currency text NOT NULL,
  provider text NOT NULL DEFAULT 'paystack',
  provider_reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  checkout_id uuid REFERENCES checkout_sessions (id),
  provider text NOT NULL,
  provider_reference text NOT NULL UNIQUE,
  amount_subunits bigint NOT NULL,
  currency text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'disputed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_account ON payments (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS credit_accounts (
  account_id uuid PRIMARY KEY REFERENCES accounts (id),
  period_id uuid,
  included_available_micros bigint NOT NULL DEFAULT 0 CHECK (included_available_micros >= 0),
  topup_available_micros bigint NOT NULL DEFAULT 0 CHECK (topup_available_micros >= 0),
  reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  kind text NOT NULL,
  included_delta_micros bigint NOT NULL,
  topup_delta_micros bigint NOT NULL,
  reserved_delta_micros bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reference_type text,
  reference_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_ledger_account ON credit_ledger (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_reservations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  request_key text NOT NULL UNIQUE,
  period_id uuid,
  reserved_micros bigint NOT NULL CHECK (reserved_micros > 0),
  included_portion_micros bigint NOT NULL CHECK (included_portion_micros >= 0),
  topup_portion_micros bigint NOT NULL CHECK (topup_portion_micros >= 0),
  consumed_micros bigint NOT NULL DEFAULT 0 CHECK (consumed_micros >= 0),
  status text NOT NULL CHECK (status IN ('held', 'settled', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS credit_reservations_held ON credit_reservations (account_id) WHERE status = 'held';

CREATE TABLE IF NOT EXISTS credit_topups (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments (id),
  amount_micros bigint NOT NULL CHECK (amount_micros > 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('openai', 'anthropic', 'openai_compatible')),
  base_url text NOT NULL,
  secret_env text,
  secret_ciphertext text,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_models (
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES ai_providers (id),
  display_name text NOT NULL,
  api_model text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  context_window integer,
  max_input_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_prices (
  id uuid PRIMARY KEY,
  model_id text NOT NULL REFERENCES ai_models (id),
  effective_from timestamptz NOT NULL DEFAULT now(),
  input_micros_per_million bigint NOT NULL CHECK (input_micros_per_million >= 0),
  output_micros_per_million bigint NOT NULL CHECK (output_micros_per_million >= 0),
  cache_read_micros_per_million bigint NOT NULL DEFAULT 0 CHECK (cache_read_micros_per_million >= 0),
  cache_write_micros_per_million bigint NOT NULL DEFAULT 0 CHECK (cache_write_micros_per_million >= 0),
  markup_bps integer NOT NULL DEFAULT 10000 CHECK (markup_bps >= 0)
);

CREATE INDEX IF NOT EXISTS model_prices_model ON model_prices (model_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS ai_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  user_id uuid NOT NULL REFERENCES users (id),
  device_id uuid,
  idempotency_key text NOT NULL,
  project_ref text,
  conversation_ref text,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  reservation_id uuid,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ai_requests_account ON ai_requests (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_usage_records (
  request_id uuid PRIMARY KEY REFERENCES ai_requests (id),
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  cache_read_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  provider_cost_micros bigint NOT NULL CHECK (provider_cost_micros >= 0),
  billed_micros bigint NOT NULL CHECK (billed_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users (id),
  action text NOT NULL,
  target text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created ON admin_audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS application_releases (
  id uuid PRIMARY KEY,
  version text NOT NULL UNIQUE,
  notes text NOT NULL DEFAULT '',
  manifest_url text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0)
);

INSERT INTO subscription_plans (
  id, name, description, currency, price_subunits, interval_days, included_allowance_micros,
  trial_allowance_micros, trial_days, max_devices, max_team_members, max_concurrent_requests,
  max_request_micros, allow_topups, allow_byok, self_serve, model_access
) VALUES
  ('free', 'Free', 'A short trial of platform models. Installed coding agents keep using your own sign-in.', 'NGN', 0, 30, 0, 1000000, 7, 1, 1, 1, 500000, false, true, true, 'listed'),
  ('pro', 'Pro', 'Monthly subscription with a fixed platform-model allowance. Unused included credits expire at renewal.', 'NGN', 2500000, 30, 15000000, 0, 0, 2, 1, 3, 2000000, true, true, true, 'all'),
  ('pro_plus', 'Pro Plus', 'A larger monthly platform-model allowance for heavier daily use.', 'NGN', 5000000, 30, 40000000, 0, 0, 3, 1, 4, 5000000, true, true, true, 'all'),
  ('business', 'Business', 'Higher device and team limits. Members do not spend the owner balance in this version.', 'NGN', 15000000, 30, 120000000, 0, 0, 10, 25, 8, 10000000, true, true, true, 'all'),
  ('enterprise', 'Enterprise', 'Contract pricing. Checkout is turned off until an administrator assigns it.', 'NGN', 0, 30, 0, 0, 0, 25, 200, 16, 20000000, true, true, false, 'all')
ON CONFLICT (id) DO NOTHING;

INSERT INTO topup_packages (id, name, currency, price_subunits, credit_micros, expires_in_days, active) VALUES
  ('topup_5', '$5 platform credits', 'NGN', 800000, 5000000, NULL, true),
  ('topup_15', '$15 platform credits', 'NGN', 2000000, 15000000, NULL, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_providers (id, name, kind, base_url, secret_env, enabled) VALUES
  ('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', 'OPENAI_API_KEY', false),
  ('anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com', 'ANTHROPIC_API_KEY', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_models (id, provider_id, display_name, api_model, enabled, context_window, max_input_tokens) VALUES
  ('gpt-4.1-mini', 'openai', 'GPT-4.1 mini', 'gpt-4.1-mini', false, 1047576, NULL),
  ('gpt-4.1-nano', 'openai', 'GPT-4.1 nano', 'gpt-4.1-nano', false, 1047576, NULL),
  ('gpt-5-mini', 'openai', 'GPT-5 mini', 'gpt-5-mini', false, 400000, NULL),
  ('claude-haiku-5-5', 'anthropic', 'Claude Haiku 5.5', 'claude-haiku-5-5', false, 1000000, 100000),
  ('claude-sonnet-5-5', 'anthropic', 'Claude Sonnet 5.5', 'claude-sonnet-5-5', false, 1000000, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_prices (id, model_id, input_micros_per_million, output_micros_per_million, cache_read_micros_per_million, cache_write_micros_per_million, markup_bps)
SELECT '00000000-0000-4000-8000-000000000011', 'gpt-4.1-mini', 400000, 1600000, 100000, 0, 10000
WHERE NOT EXISTS (SELECT 1 FROM model_prices WHERE model_id = 'gpt-4.1-mini');

INSERT INTO model_prices (id, model_id, input_micros_per_million, output_micros_per_million, cache_read_micros_per_million, cache_write_micros_per_million, markup_bps)
SELECT '00000000-0000-4000-8000-000000000012', 'gpt-4.1-nano', 100000, 400000, 25000, 0, 10000
WHERE NOT EXISTS (SELECT 1 FROM model_prices WHERE model_id = 'gpt-4.1-nano');

INSERT INTO model_prices (id, model_id, input_micros_per_million, output_micros_per_million, cache_read_micros_per_million, cache_write_micros_per_million, markup_bps)
SELECT '00000000-0000-4000-8000-000000000013', 'gpt-5-mini', 250000, 2000000, 25000, 0, 10000
WHERE NOT EXISTS (SELECT 1 FROM model_prices WHERE model_id = 'gpt-5-mini');

INSERT INTO model_prices (id, model_id, input_micros_per_million, output_micros_per_million, cache_read_micros_per_million, cache_write_micros_per_million, markup_bps)
SELECT '00000000-0000-4000-8000-000000000014', 'claude-haiku-5-5', 100000, 500000, 10000, 125000, 10000
WHERE NOT EXISTS (SELECT 1 FROM model_prices WHERE model_id = 'claude-haiku-5-5');

INSERT INTO model_prices (id, model_id, input_micros_per_million, output_micros_per_million, cache_read_micros_per_million, cache_write_micros_per_million, markup_bps)
SELECT '00000000-0000-4000-8000-000000000015', 'claude-sonnet-5-5', 2000000, 10000000, 100000, 2500000, 10000
WHERE NOT EXISTS (SELECT 1 FROM model_prices WHERE model_id = 'claude-sonnet-5-5');

INSERT INTO plan_models (plan_id, model_id) VALUES
  ('free', 'gpt-4.1-mini'),
  ('free', 'gpt-4.1-nano'),
  ('free', 'claude-haiku-5-5')
ON CONFLICT DO NOTHING;

INSERT INTO system_settings (key, value) VALUES
  ('low_credit_bps', '2000'::jsonb),
  ('topup_expiry_days', 'null'::jsonb),
  ('unverified_usage_policy', '"release"'::jsonb)
ON CONFLICT (key) DO NOTHING;
