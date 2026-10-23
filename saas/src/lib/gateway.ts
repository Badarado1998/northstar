import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import { releaseReservation, reserveCredits, settleReservation } from './ledger';
import { money } from './money';
import { estimateReservationMicros, estimateTokens, priceUsage, ratesFromRow, type TokenUsage } from './pricing';
import { decryptSecret } from './secrets';
import type { Principal } from './auth';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatInput {
  modelId: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  idempotencyKey: string;
  projectRef?: string | null;
  conversationRef?: string | null;
}

export interface ChatSuccess {
  text: string;
  billedMicros: bigint;
  providerCostMicros: bigint;
  usage: TokenUsage;
  alreadyCompleted: boolean;
}

interface ModelConfig {
  id: string;
  api_model: string;
  provider_id: string;
  kind: 'openai' | 'anthropic' | 'openai_compatible';
  base_url: string;
  secret_env: string | null;
  secret_ciphertext: string | null;
  max_input_tokens: number | null;
  max_concurrent_requests: number;
  max_request_micros: string;
  model_access: string;
  billing_hold: boolean;
}

export function parseOpenAiSse(body: string): { text: string; usage: TokenUsage | null } {
  let text = '';
  let usage: TokenUsage | null = null;
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
    text += json.choices?.[0]?.delta?.content ?? '';
    if (json.usage) {
      usage = {
        inputTokens: BigInt(json.usage.prompt_tokens ?? 0),
        outputTokens: BigInt(json.usage.completion_tokens ?? 0),
        cacheReadTokens: BigInt(json.usage.prompt_tokens_details?.cached_tokens ?? 0),
        cacheWriteTokens: 0n,
      };
    }
  }
  return { text, usage };
}

export function parseAnthropicSse(body: string): { text: string; usage: TokenUsage | null } {
  let text = '';
  let input = 0n;
  let output = 0n;
  let cacheRead = 0n;
  let cacheWrite = 0n;
  let sawUsage = false;
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const json = JSON.parse(line.slice(5).trim()) as {
      type?: string;
      delta?: { type?: string; text?: string };
      message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
      usage?: { output_tokens?: number };
    };
    if (json.type === 'content_block_delta' && json.delta?.text) text += json.delta.text;
    if (json.type === 'message_start' && json.message?.usage) {
      sawUsage = true;
      input = BigInt(json.message.usage.input_tokens ?? 0);
      cacheRead = BigInt(json.message.usage.cache_read_input_tokens ?? 0);
      cacheWrite = BigInt(json.message.usage.cache_creation_input_tokens ?? 0);
    }
    if (json.type === 'message_delta' && json.usage) {
      sawUsage = true;
      output = BigInt(json.usage.output_tokens ?? 0);
    }
  }
  return { text, usage: sawUsage ? { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite } : null };
}

async function modelConfig(db: Db, principal: Principal, modelId: string): Promise<ModelConfig> {
  const rows = await db.query<ModelConfig>(`SELECT m.id, m.api_model, m.provider_id, p.kind, p.base_url, p.secret_env, p.secret_ciphertext,
      m.max_input_tokens, plan.max_concurrent_requests, plan.max_request_micros::text, plan.model_access, a.billing_hold
    FROM ai_models m
    JOIN ai_providers p ON p.id = m.provider_id
    JOIN accounts a ON a.id = $2
    JOIN subscriptions s ON s.account_id = a.id
    JOIN subscription_plans plan ON plan.id = s.plan_id
    WHERE m.id = $1 AND m.enabled = true AND p.enabled = true AND s.status IN ('trialing', 'active')`, [modelId, principal.accountId]);
  const model = rows[0];
  if (!model) throw Object.assign(new Error('That model is not available on this account.'), { status: 403 });
  if (model.billing_hold) throw Object.assign(new Error('Billing is on hold for this account.'), { status: 402 });
  if (model.model_access === 'listed') {
    const allowed = await db.query(`SELECT 1 FROM plan_models pm JOIN subscriptions s ON s.plan_id = pm.plan_id WHERE s.account_id = $1 AND pm.model_id = $2`, [principal.accountId, modelId]);
    if (!allowed.length) throw Object.assign(new Error('This plan does not include that model.'), { status: 403 });
  }
  return model;
}

function providerSecret(model: ModelConfig): string {
  if (model.secret_ciphertext && process.env.SECRETS_KEY) return decryptSecret(model.secret_ciphertext, process.env.SECRETS_KEY);
  const fromEnv = model.secret_env ? process.env[model.secret_env]?.trim() : '';
  if (!fromEnv) throw Object.assign(new Error('This model is not configured.'), { status: 503 });
  return fromEnv;
}

export async function completeChat(db: Db, principal: Principal, input: ChatInput, fetchImpl: typeof fetch = fetch): Promise<ChatSuccess> {
  if (!principal.emailVerified) throw Object.assign(new Error('Verify your email before using platform models.'), { status: 403 });
  if (!input.idempotencyKey || !/^[A-Za-z0-9:_-]{8,80}$/.test(input.idempotencyKey)) throw Object.assign(new Error('Provide an idempotency key.'), { status: 400 });
  if (!input.messages.length || input.messages.length > 20) throw Object.assign(new Error('Send between 1 and 20 messages.'), { status: 400 });
  if (input.messages.some(message => !message.content || message.content.length > 32_000 || (message.role !== 'user' && message.role !== 'assistant'))) {
    throw Object.assign(new Error('A message is empty, too long, or has an unsupported role.'), { status: 400 });
  }
  const maxOutput = input.maxOutputTokens;
  if (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > 4096) throw Object.assign(new Error('Output cap must be from 1 to 4096 tokens.'), { status: 400 });
  const model = await modelConfig(db, principal, input.modelId);
  const existing = await db.query<{ id: string; status: string }>(`SELECT id::text, status FROM ai_requests WHERE account_id = $1 AND idempotency_key = $2`, [principal.accountId, input.idempotencyKey]);
  if (existing[0]?.status === 'settled' || existing[0]?.status === 'released' || existing[0]?.status === 'rejected') {
    const usageRows = await db.query<{ input_tokens: string; output_tokens: string; cache_read_tokens: string; cache_write_tokens: string; provider_cost_micros: string; billed_micros: string }>(
      `SELECT input_tokens::text, output_tokens::text, cache_read_tokens::text, cache_write_tokens::text, provider_cost_micros::text, billed_micros::text
       FROM ai_usage_records WHERE request_id = $1`, [existing[0].id]);
    const usage = usageRows[0];
    if (!usage) throw Object.assign(new Error('This request already finished and was not billed again.'), { status: 409 });
    return {
      text: '',
      alreadyCompleted: true,
      billedMicros: money(usage.billed_micros),
      providerCostMicros: money(usage.provider_cost_micros),
      usage: { inputTokens: money(usage.input_tokens), outputTokens: money(usage.output_tokens), cacheReadTokens: money(usage.cache_read_tokens), cacheWriteTokens: money(usage.cache_write_tokens) },
    };
  }
  if (existing[0]) throw Object.assign(new Error('This request is already running.'), { status: 409 });
  const prices = await db.query<{ input_micros_per_million: string; output_micros_per_million: string; cache_read_micros_per_million: string; cache_write_micros_per_million: string; markup_bps: string }>(
    `SELECT input_micros_per_million::text, output_micros_per_million::text, cache_read_micros_per_million::text, cache_write_micros_per_million::text, markup_bps::text
     FROM model_prices WHERE model_id = $1 ORDER BY effective_from DESC LIMIT 1`, [model.id]);
  if (!prices[0]) throw Object.assign(new Error('This model has no price.'), { status: 503 });
  const rates = ratesFromRow(prices[0]);
  const inputTokens = input.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0n);
  if (model.max_input_tokens !== null && inputTokens > BigInt(model.max_input_tokens)) {
    throw Object.assign(new Error('This prompt is above the priced input limit for that model.'), { status: 400 });
  }
  const estimate = estimateReservationMicros(inputTokens, BigInt(maxOutput), rates);
  if (estimate > money(model.max_request_micros)) throw Object.assign(new Error('This request exceeds the per-request spending limit.'), { status: 402 });
  const requestId = randomUUID();
  const requestKey = `ai:${principal.accountId}:${input.idempotencyKey}`;
  const reserved = await reserveCredits(db, { accountId: principal.accountId, requestKey, amountMicros: estimate === 0n ? 1n : estimate, maxConcurrent: model.max_concurrent_requests });
  if (!reserved.ok) throw Object.assign(new Error(reserved.error), { status: reserved.code === 'too_many_requests' ? 429 : 402 });
  await db.query(`INSERT INTO ai_requests (
      id, account_id, user_id, device_id, idempotency_key, project_ref, conversation_ref, provider_id, model_id, reservation_id, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reserved')`, [
    requestId, principal.accountId, principal.userId, principal.deviceId, input.idempotencyKey, input.projectRef ?? null, input.conversationRef ?? null, model.provider_id, model.id, reserved.reservation.id,
  ]);
  try {
    const secret = providerSecret(model);
    const response = await fetchImpl(providerUrl(model), { method: 'POST', headers: providerHeaders(model, secret), body: JSON.stringify(providerBody(model, input.messages, maxOutput)), signal: AbortSignal.timeout(55_000) });
    const body = await response.text();
    if (!response.ok) {
      await releaseReservation(db, { accountId: principal.accountId, requestKey });
      await db.query(`UPDATE ai_requests SET status = 'released', error = $2, completed_at = now() WHERE id = $1`, [requestId, `provider_http_${response.status}`]);
      throw Object.assign(new Error('The model provider rejected the request. Credits were not charged.'), { status: 502 });
    }
    const parsed = model.kind === 'anthropic' ? parseAnthropicSse(body) : parseOpenAiSse(body);
    if (!parsed.usage) {
      await releaseReservation(db, { accountId: principal.accountId, requestKey });
      await db.query(`UPDATE ai_requests SET status = 'released', error = 'missing_usage', completed_at = now() WHERE id = $1`, [requestId]);
      throw Object.assign(new Error('The provider did not report token usage, so this request was not billed.'), { status: 502 });
    }
    const priced = priceUsage(parsed.usage, rates);
    const settled = await settleReservation(db, { accountId: principal.accountId, requestKey, billedMicros: priced.billedMicros });
    if (!settled.ok) throw new Error(settled.error);
    await db.query(`INSERT INTO ai_usage_records (
        request_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, provider_cost_micros, billed_micros
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      requestId, parsed.usage.inputTokens.toString(), parsed.usage.outputTokens.toString(), parsed.usage.cacheReadTokens.toString(), parsed.usage.cacheWriteTokens.toString(), priced.providerCostMicros.toString(), settled.billedMicros.toString(),
    ]);
    await db.query(`UPDATE ai_requests SET status = 'settled', completed_at = now() WHERE id = $1`, [requestId]);
    return { text: parsed.text, billedMicros: settled.billedMicros, providerCostMicros: priced.providerCostMicros, usage: parsed.usage, alreadyCompleted: false };
  } catch (error) {
    if (error instanceof Error && 'status' in error) throw error;
    const released = await releaseReservation(db, { accountId: principal.accountId, requestKey }).catch(() => null);
    if (released?.ok && released.reservation.status === 'released') {
      await db.query(`UPDATE ai_requests SET status = 'released', error = 'provider_failure', completed_at = now() WHERE id = $1 AND status = 'reserved'`, [requestId]);
      throw Object.assign(new Error('The model request failed before usage could be verified. Credits were not charged.'), { status: 502 });
    }
    throw Object.assign(new Error('The request could not be recorded after the provider responded. It was not run again.'), { status: 500 });
  }
}

function providerUrl(model: ModelConfig): string {
  const base = model.base_url.replace(/\/$/, '');
  return model.kind === 'anthropic' ? `${base}/v1/messages` : `${base}/chat/completions`;
}

function providerHeaders(model: ModelConfig, secret: string): Record<string, string> {
  if (model.kind === 'anthropic') return { 'x-api-key': secret, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  return { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
}

function providerBody(model: ModelConfig, messages: ChatMessage[], maxOutputTokens: number): unknown {
  if (model.kind === 'anthropic') return { model: model.api_model, max_tokens: maxOutputTokens, stream: true, messages };
  return { model: model.api_model, max_tokens: maxOutputTokens, stream: true, stream_options: { include_usage: true }, messages };
}
