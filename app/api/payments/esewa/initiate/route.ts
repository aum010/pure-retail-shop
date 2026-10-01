import { apiHandler, json, parseAmount, parseOrderId, readCustomer, readJson } from "@/server/api";
import { buildEsewaInitiate } from "@/server/esewa";
import { callbackUrl } from "@/server/origin";
import { createOrder } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/esewa/initiate.
 *
 * Validates the amount server-side, builds the signed ePay v2 form, and writes
 * the order **before** responding — so a late callback can always find the row
 * that holds the amount actually charged.
 */
export const POST = apiHandler(async (request: Request): Promise<Response> => {
  const body = await readJson(request);
  const orderId = parseOrderId(body.orderId);
  const amount = parseAmount(body.amount);
  const description = String(body.description ?? "Order payment").slice(0, 100);
  const customer = readCustomer(body);

  const order = { orderId, provider: "esewa" as const, amount, description, customer, gatewayRef: "" };
  const url = await callbackUrl("esewa");
  const result = buildEsewaInitiate({ order, successUrl: url, failureUrl: url });

  // Remember the charged amount so verify never trusts the client.
  await createOrder({ ...order, gatewayRef: result.transactionUuid });

  return json({
    provider: "esewa",
    mode: result.mode,
    action: result.action,
    method: result.method,
    fields: result.fields,
    orderId,
    amount,
    transactionUuid: result.transactionUuid,
  });
});
