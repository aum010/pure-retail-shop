import { NextResponse } from "next/server";
import { apiHandler, json, readJson } from "@/server/api";
import { decodeEsewaData, verifyEsewaCallback } from "@/server/esewa";
import { formatNpr } from "@/server/money";
import { markCompleted, resolveOrderForCallback, type StoredOrder } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 404 with the legacy body shape: `{ ok:false, status:'failed', message }`. */
function orderNotFound(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      status: "failed",
      message: "No matching order was found for this payment. It may have expired.",
    },
    { status: 404 }
  );
}

/**
 * POST /api/payments/esewa/verify.
 *
 * Order of checks is load-bearing and mirrors `server/index.ts` exactly:
 *
 *   1. find the order   — eSewa's callback carries no order id, so the
 *                        transaction uuid in the payload is authoritative
 *   2. replay guard     — answered *before* any amount comparison, so a forged
 *                        payload can never rewrite a settled row
 *   3. failure redirect — no payload at all, just an error code
 *   4. verify signature — and only then compare amounts
 *
 * The legacy `test:api` and `test:store` suites assert each of these in order.
 */
export const POST = apiHandler(async (request: Request): Promise<Response> => {
  const body = await readJson(request);
  const orderId = body.orderId ? String(body.orderId) : undefined;
  const encoded = body.data ? String(body.data) : undefined;

  let order: StoredOrder | null = await resolveOrderForCallback(orderId, undefined);

  // eSewa's callback omits our order id, so recover it from the payload.
  if (!order && encoded) {
    try {
      const payload = decodeEsewaData(encoded);
      order = await resolveOrderForCallback(undefined, payload.transaction_uuid);
    } catch {
      order = null;
    }
  }

  if (!order) return orderNotFound();

  if (order.completedAt) {
    return json({
      ok: true,
      status: "completed",
      message: "This payment was already verified.",
      orderId: order.orderId,
      amount: order.result?.amount ?? order.amount,
      transactionId: order.result?.transactionId,
      transactionCode: order.result?.transactionCode,
      replay: true,
    });
  }

  // A failure redirect carries an error code and no payload.
  if (!encoded) {
    const code = String(body.errorCode ?? "unknown");
    return json({
      ok: true,
      status: "failed",
      gatewayStatus: code.toUpperCase(),
      message: `eSewa reported an error while processing the payment (${code}).`,
      orderId: order.orderId,
      amount: order.amount,
    });
  }

  const verification = verifyEsewaCallback(encoded, order.amount);

  // Amount must match what the server charged.
  if (verification.status === "completed" && Math.abs(verification.amount - order.amount) > 0.01) {
    verification.status = "failed";
    verification.message = `eSewa reported ${formatNpr(verification.amount)} but the order was for ${formatNpr(order.amount)}.`;
  }

  if (verification.status === "completed") {
    await markCompleted(order.orderId, {
      status: verification.status,
      transactionId: verification.transactionId,
      transactionCode: verification.transactionCode,
      amount: order.amount,
    });
  }

  return json({
    ok: true,
    provider: "esewa",
    status: verification.status,
    gatewayStatus: verification.gatewayStatus,
    message: verification.message,
    orderId: order.orderId,
    amount: order.amount,
    transactionId: verification.transactionId,
    transactionCode: verification.transactionCode,
    signatureValid: verification.signatureValid,
    source: verification.source,
  });
});