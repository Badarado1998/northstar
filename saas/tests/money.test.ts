import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { formatUsd } from '../src/lib/money';
import { estimateReservationMicros, priceUsage } from '../src/lib/pricing';
import { amountMatches, parseVerifiedCharge, verifySignature } from '../src/lib/paystack';
import { hashPassword, verifyPassword } from '../src/lib/passwords';

const rates = { inputMicrosPerMillion: 400_000n, outputMicrosPerMillion: 1_600_000n, cacheReadMicrosPerMillion: 100_000n, cacheWriteMicrosPerMillion: 0n, markupBps: 12_000n };

test('token prices use integer half-up rounding and a separate markup', () => {
  const priced = priceUsage({ inputTokens: 1_000_000n, outputTokens: 1_000n, cacheReadTokens: 0n, cacheWriteTokens: 0n }, rates);
  assert.equal(priced.providerCostMicros, 401_600n);
  assert.equal(priced.billedMicros, 481_920n);
  assert.equal(estimateReservationMicros(4n, 1n, { ...rates, markupBps: 10_000n }), 4n);
  assert.equal(formatUsd(15_000_000n), '$15.00');
  assert.equal(formatUsd(150_000n), '$0.15');
});

test('Paystack signatures and amounts are compared without trusting the redirect', () => {
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ns_test_reference', amount: 2500000, currency: 'NGN' } });
  const secret = 'sk_test_secret';
  const signature = createHmac('sha512', secret).update(body).digest('hex');
  assert.equal(verifySignature(body, signature, secret), true);
  assert.equal(verifySignature(body, signature, 'other'), false);
  assert.equal(verifySignature(body + ' ', signature, secret), false);
  const charge = parseVerifiedCharge({ data: { reference: 'ns_test_reference', amount: 2500000, currency: 'NGN', status: 'success', customer: { customer_code: 'CUS_1' } } });
  assert.equal(amountMatches(2_500_000n, charge.amountSubunits, 'NGN', charge.currency), true);
  assert.equal(amountMatches(2_500_001n, charge.amountSubunits, 'NGN', charge.currency), false);
});

test('passwords verify only against the stored scrypt hash', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong horse battery', hash), false);
  assert.equal(await verifyPassword('correct horse battery', 'scrypt$bad'), false);
});
