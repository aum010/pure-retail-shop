import { NextResponse } from "next/server";
import { apiHandler, json, readJson } from "@/server/api";
import { verifyKhalti } from "@/server/khalti";
import { markCompleted, resolveOrderForCallback, type StoredOrder } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * POST /api/payments/khalti/verify.
 *
 * The callback is only a hint: the reference must belong to *this* order, and a
 * completed order stays completed (replay before anything else).
 */
export const POST = apiHandler(async (request: Request): Promise<Response> => {
  const body = await readJson(request);
  const pidx = body.pidx ? String(body.pidx) : undefined;
  const orderId = body.orderId ? String(body.orderId) : undefined;
  const callbackStatus = body.status ? String(body.status) : undefined;

  const order: StoredOrder | null = await resolveOrderForCallback(orderId, pidx);

  if (!order) return orderNotFound();

  if (order.completedAt) {
    return json({
      ok: true,
      status: "completed",
      message: "This payment was already verified.",
      orderId: order.orderId,
      amount: order.result?.amount ?? order.amount,
      transactionId: order.result?.transactionId,
      replay: true,
    });
  }

  const verification = await verifyKhalti({
    pidx: pidx ?? order.gatewayRef,
    expectedAmount: order.amount,
    callbackStatus,
  });

  if (verification.status === "completed") {
    await markCompleted(order.orderId, {
      status: "completed",
      transactionId: verification.transactionId,
      amount: order.amount,
    });
  }

  return json({
    ok: true,
    provider: "khalti",
    status: verification.status,
    gatewayStatus: verification.gatewayStatus,
    message: verification.message,
    orderId: order.orderId,
    pidx: verification.pidx,
    amount: order.amount,
    transactionId: verification.transactionId,
    source: verification.source,
  });
});