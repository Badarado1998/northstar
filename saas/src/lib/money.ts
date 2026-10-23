/** USD micros: 1_000_000 micros = $1. All balances use this integer unit. */

const SCALE = 1_000_000n;

export function money(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Money value is not a safe integer.');
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error('Money value is missing or malformed.');
}

/** Half-up division so a half micro rounds away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Cannot divide money by a non-positive number.');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

export function formatUsd(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(6, '0');
  let end = 6;
  while (end > 2 && frac[end - 1] === '0') end -= 1;
  return `${negative ? '-' : ''}$${whole.toString()}.${frac.slice(0, end)}`;
}

export function formatSubunits(subunits: bigint, currency: string): string {
  const scale = currency === 'NGN' || currency === 'GHS' || currency === 'ZAR' || currency === 'KES' || currency === 'USD' ? 100n : 100n;
  const negative = subunits < 0n;
  const abs = negative ? -subunits : subunits;
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(2, '0');
  const prefix = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : `${currency} `;
  return `${negative ? '-' : ''}${prefix}${whole.toString()}.${frac}`;
}
