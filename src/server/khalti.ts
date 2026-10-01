/**
 * Khalti server integration.
 *
 * Lifted verbatim from `server/khalti.ts` for the same reason as
 * `src/server/esewa.ts`: there is no framework coupling here, only the import
 * path changes.
 */
import { randomBytes } from "node:crypto";
import { config, khaltiBaseUrl, usesRealKhalti } from "@/server/config";
import { formatNpr } from "@/server/money";
import type { StoredOrder } from "@/server/orders";

/** Khalti works in paisa; amounts are whole rupees in the storefront. */
export const toPaisa = (amount: number) => Math.round(amount * 100);

/** pidx / tidx are 20-char alphanumeric tokens. */
export function generatePidx() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(20);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function authHeaders() {
  return {
    Authorization: `Key ${config.khalti.secretKey}`,
    "Content-Type": "application/json",
  };
}

export interface KhaltiInitiateInput {
  order: Pick<StoredOrder, "orderId" | "amount" | "description">;
  returnUrl: string;
  /** The storefront's own origin, as the shopper reached it. */
  websiteUrl: string;
}

export interface KhaltiInitiateResult {
  mode: "mock" | "live";
  pidx: string;
  /** Where the browser is redirected to complete payment. */
  redirectUrl: string;
  amountPaisa: number;
  request: Record<string, string>;
}

export interface KhaltiLookupResponse {
  pidx: string;
  total_amount: number;
  status: string;
  transaction_id: string | null;
  fee: number;
  refunded: boolean;
}

/** Per the docs, only "Completed" is a success. */
const SUCCESS_STATUS = "Completed";
const FAILED_STATUSES = ["User canceled", "Expired", "Failed", "Refunded"];

export function classifyKhaltiStatus(status: string): "completed" | "pending" | "failed" {
  if (status === SUCCESS_STATUS) return "completed";
  if (FAILED_STATUSES.includes(status)) return "failed";
  return "pending";
}

export interface KhaltiVerification {
  status: "completed" | "pending" | "failed";
  gatewayStatus: string;
  message: string;
  pidx: string;
  transactionId?: string;
  amount: number;
  source: "callback" | "lookup";
  raw?: KhaltiLookupResponse;
}

/**
 * Initiates a payment. In live mode this calls Khalti's server-side endpoint
 * with the secret key and returns the checkout redirect. In mock mode it
 * returns the same shape pointed at the in-app simulated checkout.
 */
export async function initiateKhalti({
  order,
  returnUrl,
  websiteUrl,
}: KhaltiInitiateInput): Promise<KhaltiInitiateResult> {
  const pidx = generatePidx();
  const amountPaisa = toPaisa(order.amount);

  const payload = {
    return_url: returnUrl,
    website_url: websiteUrl,
    amount: String(amountPaisa),
    purchase_order_id: order.orderId,
    purchase_order_name: order.description.slice(0, 100),
    mode: config.khalti.env === "production" ? "live" : "test",
    pidx,
  };

  if (usesRealKhalti) {
    const response = await fetch(`${khaltiBaseUrl}/api/v2/epayment/initiate/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Khalti initiate failed (HTTP ${response.status}): ${detail.slice(0, 200)}`);
    }

    const body = (await response.json()) as { pidx?: string };
    const resolvedPidx = body.pidx ?? pidx;

    return {
      mode: "live",
      pidx: resolvedPidx,
      redirectUrl: `${khaltiBaseUrl}/v2/checkout?pidx=${encodeURIComponent(resolvedPidx)}`,
      amountPaisa,
      request: payload as unknown as Record<string, string>,
    };
  }

  const query = new URLSearchParams({
    ...payload,
    _amount: order.amount.toFixed(2),
  } as Record<string, string>);
  return {
    mode: "mock",
    pidx,
    redirectUrl: `${websiteUrl}/pay/khalti?${query.toString()}`,
    amountPaisa,
    request: payload as unknown as Record<string, string>,
  };
}

/** Calls Khalti's lookup endpoint, which is the authoritative check. */
export async function lookupKhalti(pidx: string): Promise<KhaltiLookupResponse> {
  const response = await fetch(`${khaltiBaseUrl}/api/v2/epayment/lookup/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ pidx }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Khalti lookup failed (HTTP ${response.status}): ${detail.slice(0, 200)}`);
  }

  return (await response.json()) as KhaltiLookupResponse;
}

/**
 * Confirms a Khalti payment. In live mode the callback is treated as a hint
 * only — the pidx is looked up server-side and that result decides the outcome.
 */
export async function verifyKhalti(input: {
  pidx: string;
  expectedAmount: number;
  callbackStatus?: string;
}): Promise<KhaltiVerification> {
  if (usesRealKhalti) {
    const result = await lookupKhalti(input.pidx);
    const status = classifyKhaltiStatus(result.status);
    const amount = result.total_amount / 100;

    // Guard against a mismatched amount even when status is Completed.
    const amountMismatch = Math.abs(amount - input.expectedAmount) > 0.01;

    return {
      status: amountMismatch ? "failed" : status,
      gatewayStatus: result.status,
      message: amountMismatch
        ? `Khalti reported ${amount.toFixed(2)} but the order was for ${input.expectedAmount.toFixed(2)}.`
        : status === "completed"
          ? `Payment of ${formatNpr(amount)} confirmed via Khalti lookup.`
          : `Khalti lookup reported "${result.status}". Hold the order until it resolves.`,
      pidx: input.pidx,
      transactionId: result.transaction_id ?? undefined,
      amount,
      source: "lookup",
      raw: result,
    };
  }

  const gatewayStatus = input.callbackStatus ?? "Completed";
  const status = classifyKhaltiStatus(gatewayStatus);

  return {
    status,
    gatewayStatus,
    message:
      status === "completed"
        ? `Payment of ${formatNpr(input.expectedAmount)} completed via Khalti.`
        : status === "failed"
          ? `Khalti payment was not completed (status: ${gatewayStatus}).`
          : `Khalti reported the payment as ${gatewayStatus}. Run a lookup before shipping.`,
    pidx: input.pidx,
    amount: input.expectedAmount,
    source: "callback",
  };
}