import { divRound, money } from './money';

export interface TokenRates {
  inputMicrosPerMillion: bigint;
  outputMicrosPerMillion: bigint;
  cacheReadMicrosPerMillion: bigint;
  cacheWriteMicrosPerMillion: bigint;
  /** 10_000 = provider cost with no markup. */
  markupBps: bigint;
}

export interface TokenUsage {
  inputTokens: bigint;
  outputTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
}

export interface PricedUsage {
  providerCostMicros: bigint;
  billedMicros: bigint;
}

export function tokenCost(tokens: bigint, microsPerMillion: bigint): bigint {
  if (tokens < 0n || microsPerMillion < 0n) throw new Error('Token price inputs cannot be negative.');
  return divRound(tokens * microsPerMillion, 1_000_000n);
}

export function priceUsage(usage: TokenUsage, rates: TokenRates): PricedUsage {
  const providerCostMicros = tokenCost(usage.inputTokens, rates.inputMicrosPerMillion)
    + tokenCost(usage.outputTokens, rates.outputMicrosPerMillion)
    + tokenCost(usage.cacheReadTokens, rates.cacheReadMicrosPerMillion)
    + tokenCost(usage.cacheWriteTokens, rates.cacheWriteMicrosPerMillion);
  return { providerCostMicros, billedMicros: divRound(providerCostMicros * rates.markupBps, 10_000n) };
}

export function estimateTokens(text: string): bigint {
  return BigInt(Math.ceil(text.length / 4));
}

export function estimateReservationMicros(inputTokens: bigint, maxOutputTokens: bigint, rates: TokenRates): bigint {
  if (maxOutputTokens < 0n) throw new Error('Output cap cannot be negative.');
  return priceUsage({
    inputTokens,
    outputTokens: maxOutputTokens,
    cacheReadTokens: 0n,
    cacheWriteTokens: 0n,
  }, rates).billedMicros;
}

export function ratesFromRow(row: {
  input_micros_per_million: unknown;
  output_micros_per_million: unknown;
  cache_read_micros_per_million: unknown;
  cache_write_micros_per_million: unknown;
  markup_bps: unknown;
}): TokenRates {
  return {
    inputMicrosPerMillion: money(row.input_micros_per_million),
    outputMicrosPerMillion: money(row.output_micros_per_million),
    cacheReadMicrosPerMillion: money(row.cache_read_micros_per_million),
    cacheWriteMicrosPerMillion: money(row.cache_write_micros_per_million),
    markupBps: money(row.markup_bps),
  };
}
