/**
 * eSewa request construction and signature verification.
 *
 * Lifted verbatim from `server/esewa.ts` in the Next.js migration: nothing here
 * couples to Express or to SQLite, so the only change is the import path. Keeping
 * this file boring is a feature — it is security-critical code that has already
 * been tested, and a rewrite would have to re-earn that trust line by line.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config, esewaBaseUrl, usesRealEsewa } from "@/server/config";
import { formatNpr } from "@/server/money";
import type { StoredOrder } from "@/server/orders";

/** eSewa's signed_field_names for an initiate request, in signing order. */
export const ESEWA_SIGNED_FIELDS = ["total_amount", "transaction_uuid", "product_code"] as const;

export const ESEWA_SIGNED_FIELD_NAMES = ESEWA_SIGNED_FIELDS.join(",");

/** HMAC-SHA256 (RFC 2104) over `name=value` pairs joined by commas, base64. */
export function signEsewa(message: string, secret = config.esewa.secretKey) {
  return createHmac("sha256", secret).update(message, "utf8").digest("base64");
}

export function toEsewaAmount(amount: number) {
  return amount.toFixed(2);
}

/** eSewa transaction ids are "YYMMDD-HHMMSS". */
export function generateTransactionUuid() {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${p(now.getFullYear() % 100)}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${date}-${time}`;
}

export interface EsewaInitiateInput {
  order: Pick<StoredOrder, "orderId" | "amount" | "description">;
  successUrl: string;
  failureUrl: string;
}

export interface EsewaInitiateResult {
  mode: "mock" | "live";
  /** URL the browser must POST/GET to. */
  action: string;
  method: "POST" | "GET";
  fields: Record<string, string>;
  transactionUuid: string;
}

/**
 * Builds the signed ePay v2 request. The signature is computed here with the
 * secret key so the key never reaches the browser.
 *
 * ePay v2 posts to /api/epay/main/v2/form and expects the full breakdown
 * (amount + charges + tax), not the legacy `amt`/`pwd` pair.
 */
export function buildEsewaInitiate({ order, successUrl, failureUrl }: EsewaInitiateInput): EsewaInitiateResult {
  const totalAmount = toEsewaAmount(order.amount);
  const productCode = config.esewa.productCode;
  const transactionUuid = generateTransactionUuid();

  const values: Record<(typeof ESEWA_SIGNED_FIELDS)[number], string> = {
    total_amount: totalAmount,
    transaction_uuid: transactionUuid,
    product_code: productCode,
  };

  const message = ESEWA_SIGNED_FIELDS.map((field) => `${field}=${values[field]}`).join(",");
  const signature = signEsewa(message);

  const fields: Record<string, string> = {
    amount: totalAmount,
    tax_amount: "0",
    total_amount: totalAmount,
    transaction_uuid: transactionUuid,
    product_service_charge: "0",
    product_delivery_charge: "0",
    product_code: productCode,
    success_url: successUrl,
    failure_url: failureUrl,
    signed_field_names: ESEWA_SIGNED_FIELD_NAMES,
    signature,
  };

  if (!usesRealEsewa) {
    // Simulation: send the same fields to the in-app gateway as a GET so the
    // shopper never leaves the storefront and no traffic reaches eSewa. The
    // origin comes from the caller's callback URL, so it points at whichever
    // address the shopper actually reached the site on.
    return {
      mode: "mock",
      action: `${new URL(successUrl).origin}/pay/esewa`,
      method: "GET",
      fields: { ...fields, _amount: totalAmount },
      transactionUuid,
    };
  }

  return {
    mode: "live",
    action: `${esewaBaseUrl}/api/epay/main/v2/form`,
    method: "POST",
    fields,
    transactionUuid,
  };
}

export interface EsewaCallbackPayload {
  transaction_code: string;
  status: string;
  total_amount: string;
  transaction_uuid: string;
  product_code: string;
  signed_field_names: string;
  signature: string;
}

export interface EsewaVerification {
  status: "completed" | "pending" | "failed";
  gatewayStatus: string;
  message: string;
  signatureValid: boolean;
  transactionId?: string;
  transactionCode?: string;
  amount: number;
  source: "callback" | "status-check";
  statusCheckUrl?: string;
}

const COMPLETE = ["COMPLETE"];
const FAILED = ["FULL_REFUND", "PARTIAL_REFUND", "CANCELED", "NOT_FOUND"];

function classify(status: string): EsewaVerification["status"] {
  const normalized = status.toUpperCase();
  if (COMPLETE.includes(normalized)) return "completed";
  if (FAILED.includes(normalized)) return "failed";
  return "pending";
}

/** Constant-time comparison of two base64 signatures. */
function signaturesMatch(a: string, b: string) {
  try {
    const bufA = Buffer.from(a, "base64");
    const bufB = Buffer.from(b, "base64");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function decodeEsewaData(encoded: string): EsewaCallbackPayload {
  const json = Buffer.from(encoded, "base64").toString("utf8");
  return JSON.parse(json) as EsewaCallbackPayload;
}

/**
 * Verifies an eSewa callback: recomputes the signature over the signed fields
 * and compares it, then classifies the status. An unverifiable signature is
 * never treated as a success.
 */
export function verifyEsewaCallback(encoded: string, expectedAmount: number): EsewaVerification {
  let payload: EsewaCallbackPayload;
  try {
    payload = decodeEsewaData(encoded);
  } catch {
    return {
      status: "failed",
      gatewayStatus: "DECODE_ERROR",
      message: "The eSewa callback payload could not be decoded.",
      signatureValid: false,
      amount: expectedAmount,
      source: "callback",
    };
  }

  const values = payload as unknown as Record<string, string>;
  const message = ESEWA_SIGNED_FIELDS.map((field) => `${field}=${values[field] ?? ""}`).join(",");

  const signatureValid = signaturesMatch(signEsewa(message), payload.signature ?? "");
  const amount = Number(String(payload.total_amount ?? "0").replace(/,/g, ""));
  const status = classify(payload.status ?? "UNKNOWN");

  // A COMPLETE callback with a bad signature is not trustworthy.
  const finalStatus = status === "completed" && !signatureValid ? "failed" : status;

  const description = !signatureValid
    ? "The eSewa response signature did not match, so the payment cannot be trusted."
    : finalStatus === "completed"
      ? `Payment of ${formatNpr(Number.isFinite(amount) ? amount : expectedAmount)} completed via eSewa.`
      : finalStatus === "failed"
        ? `eSewa payment was not completed (status: ${payload.status}).`
        : `eSewa reported the payment as ${payload.status}. Hold the order and re-check.`;

  return {
    status: finalStatus,
    gatewayStatus: (payload.status ?? "UNKNOWN").toUpperCase(),
    message: description,
    signatureValid,
    transactionId: payload.transaction_uuid,
    transactionCode: payload.transaction_code,
    amount: Number.isFinite(amount) ? amount : expectedAmount,
    source: "callback",
  };
}

export interface EsewaStatusCheck {
  product_code: string;
  transaction_uuid: string;
  total_amount: number;
  status: string;
  ref_id: string | null;
}

/** Live status check against eSewa's transaction status endpoint. */
export async function checkEsewaStatus(input: {
  transactionUuid: string;
  totalAmount: number;
  productCode?: string;
}): Promise<EsewaStatusCheck> {
  const productCode = input.productCode ?? config.esewa.productCode;
  const url = new URL(`${esewaBaseUrl}/api/epay/transaction/status/`);
  url.searchParams.set("product_code", productCode);
  url.searchParams.set("total_amount", String(input.totalAmount));
  url.searchParams.set("transaction_uuid", input.transactionUuid);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`eSewa status check failed with HTTP ${response.status}`);
    }
    return (await response.json()) as EsewaStatusCheck;
  } finally {
    clearTimeout(timeout);
  }
}

/** Builds the status-check URL so the client can see what the server called. */
export function buildEsewaStatusCheckUrl(input: {
  transactionUuid: string;
  totalAmount: number;
  productCode?: string;
}) {
  const url = new URL(`${esewaBaseUrl}/api/epay/transaction/status/`);
  url.searchParams.set("product_code", input.productCode ?? config.esewa.productCode);
  url.searchParams.set("total_amount", String(input.totalAmount));
  url.searchParams.set("transaction_uuid", input.transactionUuid);
  return url.toString();
}