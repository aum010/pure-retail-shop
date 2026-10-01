import { apiHandler, json, notFound, readJson } from "@/server/api";
import { usesRealEsewa } from "@/server/config";
import { buildEsewaStatusCheckUrl, checkEsewaStatus } from "@/server/esewa";
import { markCompleted, resolveOrderForCallback } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/esewa/status — the server-side check used when no callback
 * arrived. In `mock` mode it answers from the stored row, since there is no
 * gateway to ask.
 */
export const POST = apiHandler(async (request: Request): Promise<Response> => {
  const body = await readJson(request);
  const order = await resolveOrderForCallback(
    body.orderId ? String(body.orderId) : undefined,
    body.transactionUuid ? String(body.transactionUuid) : undefined
  );
  if (!order) throw notFound("Order not found.");

  const transactionUuid = String(body.transactionUuid ?? order.gatewayRef);
  const statusCheckUrl = buildEsewaStatusCheckUrl({ transactionUuid, totalAmount: order.amount });

  if (!usesRealEsewa) {
    return json({
      ok: true,
      provider: "esewa",
      status: order.completedAt ? "completed" : "pending",
      gatewayStatus: order.completedAt ? "COMPLETE" : "PENDING",
      message: `Mock status check for ${transactionUuid}.`,
      orderId: order.orderId,
      amount: order.amount,
      transactionId: transactionUuid,
      statusCheckUrl,
      source: "status-check",
    });
  }

  const result = await checkEsewaStatus({ transactionUuid, totalAmount: order.amount });
  const status = result.status === "COMPLETE" ? "completed" : result.status === "PENDING" ? "pending" : "failed";

  if (status === "completed" && !order.completedAt) {
    await markCompleted(order.orderId, { status, transactionId: transactionUuid, amount: order.amount });
  }

  return json({
    ok: true,
    provider: "esewa",
    status,
    gatewayStatus: result.status,
    message: `eSewa status check returned ${result.status}.`,
    orderId: order.orderId,
    amount: order.amount,
    transactionId: transactionUuid,
    refId: result.ref_id,
    statusCheckUrl,
    source: "status-check",
  });
});