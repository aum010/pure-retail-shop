/**
 * Verifies the in-page checkout: the browser initiates a payment, rebuilds the
 * callback the wallet would have sent, and posts it to the verify endpoint —
 * with no redirect and no popup anywhere in the path.
 *
 * This imports the *real* client builder, so the shape the browser produces is
 * the shape under test rather than a hand-written copy of it.
 */
import { post, check, summary, runTag } from "./test-helpers.js";
import { buildSimulatedCallback } from "../src/lib/payments/simulated-gateway.js";
import type { InitiateResponse } from "../src/lib/payments/api.js";
import type { SimulatedOutcome } from "../src/lib/payments/simulated-gateway.js";

const order = (suffix: string) => `ORD-INPAGE-${suffix}-${runTag}`;

/** Mirrors `handleWalletPay`: initiate, rebuild the callback, verify in place. */
async function payInPage(provider: "esewa" | "khalti", suffix: string, outcome: SimulatedOutcome) {
  const initiated = await post(`/api/payments/${provider}/initiate`, {
    orderId: order(suffix),
    amount: 1425,
    description: "In-page checkout",
    customer: { name: "Test", email: "t@example.com" },
  });

  if (initiated.status !== 200) {
    return { initiated, verified: null, callback: null };
  }

  const request = { ...initiated.body, provider, mode: "mock" } as unknown as InitiateResponse;
  const callback = buildSimulatedCallback(provider, request, outcome);
  const verified = await post(`/api/payments/${provider}/verify`, callback);
  return { initiated, verified, callback };
}

console.log("\n=== In-page eSewa ===\n");

const eSuccess = await payInPage("esewa", "E1", "success");
check("initiate succeeds", eSuccess.initiated.status === 200, eSuccess.initiated.body);
check(
  "the callback needs no navigation to produce",
  typeof eSuccess.callback?.data === "string" && eSuccess.callback.data.length > 0,
  eSuccess.callback
);
check("approving settles as completed", eSuccess.verified?.body.status === "completed", eSuccess.verified?.body);
check("signature verified", eSuccess.verified?.body.signatureValid === true, eSuccess.verified?.body);
check("amount preserved", eSuccess.verified?.body.amount === 1425, eSuccess.verified?.body.amount);

// The payload is base64 JSON, exactly as eSewa returns it.
const eDecoded = JSON.parse(Buffer.from(String(eSuccess.callback?.data), "base64").toString("utf8"));
check("payload is base64 JSON with a COMPLETE status", eDecoded.status === "COMPLETE", eDecoded);

const ePending = await payInPage("esewa", "E2", "pending");
check("pending is not a success", ePending.verified?.body.status === "pending", ePending.verified?.body);

const eFailed = await payInPage("esewa", "E3", "failed");
check("failed reports failed", eFailed.verified?.body.status === "failed", eFailed.verified?.body);

const eCancel = await payInPage("esewa", "E4", "canceled");
check("cancel reports failed", eCancel.verified?.body.status === "failed", eCancel.verified?.body);
check(
  "cancel is sent the way eSewa sends it",
  eCancel.callback?.errorCode === "payment_cancelled" && !eCancel.callback?.data,
  eCancel.callback
);

// A payload the browser rewrote must not settle: the signature comes from the
// server, so changing the amount invalidates it.
await post("/api/payments/esewa/initiate", {
  orderId: order("E5"),
  amount: 1425,
  description: "Tamper check",
});
const eTampered = await post("/api/payments/esewa/verify", {
  orderId: order("E5"),
  data: Buffer.from(
    JSON.stringify({ ...eDecoded, total_amount: "1.00" }),
    "utf8"
  ).toString("base64"),
});
check(
  "a rewritten amount cannot be forged in the browser",
  eTampered.body.status !== "completed",
  eTampered.body
);

console.log("\n=== In-page Khalti ===\n");

const kSuccess = await payInPage("khalti", "K1", "success");
check("approving settles as completed", kSuccess.verified?.body.status === "completed", kSuccess.verified?.body);
check("pidx carried on the callback", Boolean(kSuccess.callback?.pidx), kSuccess.callback);

const kPending = await payInPage("khalti", "K2", "pending");
check("pending is not a success", kPending.verified?.body.status !== "completed", kPending.verified?.body);

const kFailed = await payInPage("khalti", "K3", "failed");
check("failed reports failed", kFailed.verified?.body.status === "failed", kFailed.verified?.body);

const kCancel = await payInPage("khalti", "K4", "canceled");
check("cancel reports failed", kCancel.verified?.body.status === "failed", kCancel.verified?.body);
check("cancel uses Khalti's own wording", kCancel.callback?.status === "User canceled", kCancel.callback);

console.log("\n=== Rapid successive checkouts ===\n");

// eSewa's transaction uuid has one-second resolution, so two checkouts started
// back to back share one. Both must still be resolvable by their order id.
const sameSecond = await Promise.all([
  post("/api/payments/esewa/initiate", { orderId: order("R1"), amount: 100, description: "R1" }),
  post("/api/payments/esewa/initiate", { orderId: order("R2"), amount: 200, description: "R2" }),
]);
check(
  "the two initiates really did share a uuid",
  sameSecond[0].body.transactionUuid === sameSecond[1].body.transactionUuid,
  { a: sameSecond[0].body.transactionUuid, b: sameSecond[1].body.transactionUuid }
);

// The in-page callback always names its order, which is what keeps a shared
// uuid unambiguous. Only the real eSewa redirect omits it, and that path has no
// way to tell two same-second checkouts apart — see the README's limitations.
const namedRequest = { ...sameSecond[0].body, mode: "mock" } as unknown as InitiateResponse;
check(
  "the in-page callback names its order, disambiguating the shared uuid",
  buildSimulatedCallback("esewa", namedRequest, "success").orderId === order("R1"),
  buildSimulatedCallback("esewa", namedRequest, "success")
);

// Claiming R1's order id while presenting R2's signed payload (same uuid, a
// different amount) must be refused. Checked before either order settles so the
// replay guard cannot mask the result.
const crossedUuid = await post("/api/payments/esewa/verify", {
  orderId: order("R1"),
  data: buildSimulatedCallback(
    "esewa",
    { ...sameSecond[1].body, mode: "mock" } as unknown as InitiateResponse,
    "success"
  ).data,
});
check(
  "a shared uuid cannot settle the wrong amount against an order",
  crossedUuid.body.status !== "completed",
  crossedUuid.body
);

for (const index of [0, 1]) {
  const expected = index === 0 ? 100 : 200;
  const request = { ...sameSecond[index].body, mode: "mock" } as unknown as InitiateResponse;
  const settled = await post(
    "/api/payments/esewa/verify",
    buildSimulatedCallback("esewa", request, "success")
  );
  check(
    `colliding order ${order(index === 0 ? "R1" : "R2")} settles for its own amount`,
    settled.body.status === "completed" && settled.body.amount === expected,
    settled.body
  );
}

console.log("\n=== Cross-order tampering ===\n");

// A reference that belongs to another order must not settle this one.
const otherPidx = (
  await post("/api/payments/khalti/initiate", { orderId: order("X1"), amount: 100, description: "X1" })
).body.pidx;
await post("/api/payments/khalti/initiate", { orderId: order("X2"), amount: 100, description: "X2" });
const crossed = await post("/api/payments/khalti/verify", {
  orderId: order("X2"),
  pidx: String(otherPidx),
  status: "Completed",
});
check("another order's pidx cannot settle this one", crossed.body.status !== "completed", crossed.body);

summary();
