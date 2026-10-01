/**
 * The simulated gateway.
 *
 * A real checkout hands the shopper to eSewa's `/api/epay/main/v2/form` or to
 * Khalti's hosted checkout, and the gateway then calls back with its own
 * parameters. This module reproduces those parameters locally so the whole
 * settlement path can be exercised without contacting either gateway.
 *
 * Nothing here runs in `live` mode, and no secret is involved: the API derives
 * the signature from the fields it issued, so a locally built callback is
 * accepted exactly the way the gateway's own callback would be.
 */
import type { InitiateResponse } from './api';
import type { PaymentProvider } from './types';

export type SimulatedOutcome = 'success' | 'pending' | 'failed' | 'canceled';

/** The outcomes a tester can drive from the checkout page, in display order. */
export const SIMULATED_OUTCOMES: ReadonlyArray<{
  value: SimulatedOutcome;
  label: string;
  hint: string;
}> = [
  { value: 'pending', label: 'Pending', hint: 'Gateway holds the payment for a later lookup' },
  { value: 'failed', label: 'Failed', hint: 'Gateway reports the payment as unsuccessful' },
  { value: 'canceled', label: 'Cancel', hint: 'Shopper abandons the checkout' },
];

/** UTF-8 safe base64 encode (btoa is latin1-only and would corrupt unicode). */
export function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** eSewa transaction ids look like "240613-134231" (YYMMDD-HHMMSS). */
export function generateEsewaTransactionUuid() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${clock}`;
}

/** Random digits, mimicking the gateway's transaction code / id values. */
export function randomNumericId(digits = 7) {
  const max = 10 ** digits;
  return String(Math.floor(Math.random() * max));
}

/**
 * eSewa reports success and "held" inside the signed payload. A cancellation
 * never reaches the payload at all — see `buildSimulatedCallback`.
 */
const ESEWA_PAYLOAD_STATUS: Record<SimulatedOutcome, string> = {
  success: 'COMPLETE',
  pending: 'PENDING',
  failed: 'CANCELED',
  canceled: 'CANCELED',
};

/** Khalti reports every outcome in the redirect query instead. */
const KHALTI_CALLBACK_STATUS: Record<SimulatedOutcome, string> = {
  success: 'Completed',
  pending: 'Pending',
  failed: 'Failed',
  canceled: 'User canceled',
};

/**
 * eSewa's success callback is a base64 JSON blob. The fields that were signed
 * at initiate time are echoed back verbatim, which is what lets the server
 * re-derive the signature and confirm the payload is genuine.
 */
export function buildEsewaPayload(request: InitiateResponse, outcome: SimulatedOutcome) {
  const fields = request.fields ?? {};
  return {
    transaction_code: randomNumericId(7),
    status: ESEWA_PAYLOAD_STATUS[outcome],
    total_amount: Number(fields.total_amount ?? request.amount).toFixed(2),
    transaction_uuid: fields.transaction_uuid ?? request.transactionUuid ?? generateEsewaTransactionUuid(),
    product_code: fields.product_code ?? 'EPAYTEST',
    signed_field_names: fields.signed_field_names ?? 'total_amount,transaction_uuid,product_code',
    signature: fields.signature ?? '',
  };
}

/**
 * Builds the body the storefront would send to `/api/payments/:provider/verify`
 * if the shopper had just come back from the gateway — identical in shape to
 * the real callback, so the server cannot tell the difference.
 */
export function buildSimulatedCallback(
  provider: PaymentProvider,
  request: InitiateResponse,
  outcome: SimulatedOutcome
): Record<string, string> {
  if (provider === 'esewa') {
    // eSewa announces a cancellation on the failure url, with no payload.
    if (outcome === 'canceled') {
      return { orderId: request.orderId, errorCode: 'payment_cancelled' };
    }

    return {
      orderId: request.orderId,
      data: encodeBase64Utf8(JSON.stringify(buildEsewaPayload(request, outcome))),
    };
  }

  return {
    orderId: request.orderId,
    pidx: request.pidx ?? request.transactionUuid ?? '',
    status: KHALTI_CALLBACK_STATUS[outcome],
  };
}
