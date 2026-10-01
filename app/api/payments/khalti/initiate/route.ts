import { apiHandler, json, parseAmount, parseOrderId, readCustomer, readJson } from "@/server/api";
import { initiateKhalti } from "@/server/khalti";
import { callbackUrl, publicOrigin } from "@/server/origin";
import { createOrder } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/payments/khalti/initiate. */
export const POST = apiHandler(async (request: Request): Promise<Response> => {
  const body = await readJson(request);
  const orderId = parseOrderId(body.orderId);
  const amount = parseAmount(body.amount);
  const description = String(body.description ?? "Order payment").slice(0, 100);
  const customer = readCustomer(body);

  const order = { orderId, provider: "khalti" as const, amount, description, customer, gatewayRef: "" };

  const result = await initiateKhalti({
    order,
    returnUrl: await callbackUrl("khalti"),
    // The storefront's own origin, as the shopper reached it.
    websiteUrl: await publicOrigin(),
  });

  await createOrder({ ...order, gatewayRef: result.pidx });

  return json({
    provider: "khalti",
    mode: result.mode,
    pidx: result.pidx,
    redirectUrl: result.redirectUrl,
    orderId,
    amount,
    amountPaisa: result.amountPaisa,
  });
});