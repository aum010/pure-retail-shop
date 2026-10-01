import { apiHandler, json, notFound } from "@/server/api";
import { getOrder } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ orderId: string }> };

/** GET /api/orders/:orderId — order status for the confirmation page. */
export const GET = apiHandler(async (_request: Request, { params }: Params): Promise<Response> => {
  const { orderId } = await params;
  const order = await getOrder(orderId);
  if (!order) throw notFound("Order not found.");

  return json({
    ok: true,
    order: {
      orderId: order.orderId,
      provider: order.provider,
      amount: order.amount,
      status: order.completedAt ? "completed" : "pending",
      transactionId: order.result?.transactionId,
      createdAt: new Date(order.createdAt).toISOString(),
    },
  });
});
