import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifiedCharge {
  reference: string;
  amountSubunits: bigint;
  currency: string;
  status: 'success' | 'failed' | 'abandoned' | 'other';
  customerCode: string | null;
  planCode: string | null;
  paidAt: string | null;
}

export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !signature || !/^[0-9a-f]{128}$/i.test(signature.trim())) return false;
  const digest = createHmac('sha512', secret).update(rawBody).digest('hex');
  const left = Buffer.from(digest, 'hex');
  const right = Buffer.from(signature.trim(), 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function amountMatches(expected: bigint, received: bigint, expectedCurrency: string, receivedCurrency: string): boolean {
  return expected === received && expectedCurrency.toUpperCase() === receivedCurrency.toUpperCase();
}

function asSubunits(value: unknown): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new Error('Paystack returned an amount that cannot be recorded safely.');
}

export function parseVerifiedCharge(body: unknown): VerifiedCharge {
  const data = (body as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== 'object') throw new Error('Paystack verify response has no transaction.');
  const reference = typeof data.reference === 'string' ? data.reference : '';
  const currency = typeof data.currency === 'string' ? data.currency : '';
  const statusRaw = typeof data.status === 'string' ? data.status : 'other';
  const status = statusRaw === 'success' || statusRaw === 'failed' || statusRaw === 'abandoned' ? statusRaw : 'other';
  const customer = data.customer as { customer_code?: unknown } | undefined;
  const plan = data.plan;
  const planCode = typeof plan === 'string' ? plan : (plan && typeof plan === 'object' && typeof (plan as { plan_code?: unknown }).plan_code === 'string' ? (plan as { plan_code: string }).plan_code : null);
  if (!reference || !currency) throw new Error('Paystack verify response is missing a reference or currency.');
  return {
    reference,
    amountSubunits: asSubunits(data.amount),
    currency,
    status,
    customerCode: typeof customer?.customer_code === 'string' ? customer.customer_code : null,
    planCode,
    paidAt: typeof data.paid_at === 'string' ? data.paid_at : null,
  };
}

export interface PaystackClient {
  initialize(input: { email: string; amountSubunits: bigint; currency: string; reference: string; callbackUrl: string; planCode?: string | null; metadata: Record<string, string> }): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<VerifiedCharge>;
  disableSubscription(code: string, emailToken: string): Promise<void>;
}

export function paystackClient(secret: string, fetchImpl: typeof fetch = fetch): PaystackClient {
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  return {
    async initialize(input) {
      const response = await fetchImpl('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: input.email,
          amount: input.amountSubunits.toString(),
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          ...(input.planCode ? { plan: input.planCode } : {}),
          metadata: input.metadata,
        }),
      });
      const body = await response.json() as { status?: boolean; data?: { authorization_url?: string }; message?: string };
      if (!response.ok || !body.status || !body.data?.authorization_url) {
        throw new Error(body.message || 'Paystack did not start checkout.');
      }
      if (!body.data.authorization_url.startsWith('https://')) throw new Error('Paystack returned an unexpected checkout URL.');
      return { authorizationUrl: body.data.authorization_url };
    },
    async verify(reference) {
      if (!/^[\w.-]{6,100}$/.test(reference)) throw new Error('That payment reference is not valid.');
      const response = await fetchImpl(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers });
      const body = await response.json();
      if (!response.ok) throw new Error('Paystack could not verify that payment.');
      return parseVerifiedCharge(body);
    },
    async disableSubscription(code, emailToken) {
      const response = await fetchImpl('https://api.paystack.co/subscription/disable', {
        method: 'POST',
        headers,
        body: JSON.stringify({ code, token: emailToken }),
      });
      if (!response.ok) throw new Error('Paystack did not cancel the subscription.');
    },
  };
}
