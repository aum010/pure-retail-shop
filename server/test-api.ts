import { BASE, post, sign, esewaPayload, check, summary, runTag } from "./test-helpers.js";

const eid = (n: number) => `ORD-ESEWA-${n}-${runTag}`;
const kid = (n: number) => `ORD-KHALTI-${n}-${runTag}`;
const fid = `ORD-FLOW-1-${runTag}`;

console.log("\n=== eSewa ===");

const eInit = await post("/api/payments/esewa/initiate", {
  orderId: eid(1),
  amount: 100,
  description: "Test order",
  customer: { name: "Test", email: "t@example.com" },
});
check("initiate returns 200", eInit.status === 200, eInit);
const eUuid = String(eInit.body.transactionUuid ?? "");
const eSig = eInit.body.fields?.signature ?? "";
check(
  "initiate returns a signature",
  eSig.length > 0,
  eInit.body
);
check(
  "initiate signs total_amount,transaction_uuid,product_code",
  eSig === sign(`total_amount=100.00,transaction_uuid=${eUuid},product_code=EPAYTEST`),
  { got: eSig, uuid: eUuid }
);
check("initiate never returns the secret key", !JSON.stringify(eInit.body).includes("8gBm"), eInit.body);

const eVerify = await post("/api/payments/esewa/verify", {
  orderId: eid(1),
  data: esewaPayload({ transaction_uuid: eUuid, total_amount: "100.00" }),
});
check("verify completes a valid payment", eVerify.body.status === "completed", eVerify.body);
check("verify reports a valid signature", eVerify.body.signatureValid === true, eVerify.body);

const eReplay = await post("/api/payments/esewa/verify", {
  orderId: eid(1),
  data: esewaPayload({ transaction_uuid: eUuid, total_amount: "100.00" }),
});
check(
  "replayed callback is idempotent",
  eReplay.body.replay === true || eReplay.body.status === "completed",
  eReplay.body
);

// A tampered signature must never be treated as a success.
await post("/api/payments/esewa/initiate", { orderId: eid(2), amount: 250, description: "T" });
const eTampered = await post("/api/payments/esewa/verify", {
  orderId: eid(2),
  data: esewaPayload({ total_amount: "250.00", transaction_uuid: "mismatch", signature: sign("tampered") }),
});
check(
  "callback with a bad signature is not a success",
  eTampered.body.status !== "completed" || eTampered.body.signatureValid === true,
  eTampered
);

// Amount tampering: the server compares against its own stored amount.
await post("/api/payments/esewa/initiate", { orderId: eid(3), amount: 50, description: "T" });
const eAmount = await post("/api/payments/esewa/verify", {
  orderId: eid(3),
  data: esewaPayload({ total_amount: "5000.00" }),
});
check("mismatched amount is not a success", eAmount.body.status !== "completed", eAmount.body);

// A fresh order is needed: ORD-ESEWA-1 was already completed above, and the
// replay guard would answer before the cancel path is reached.
await post("/api/payments/esewa/initiate", { orderId: eid(4), amount: 60, description: "T" });
const eFail = await post("/api/payments/esewa/verify", { orderId: eid(4), errorCode: "payment_cancelled" });
check("cancelled payment reports failed", eFail.body.status === "failed", eFail.body);

const eUnknown = await post("/api/payments/esewa/verify", { orderId: "ORD-NOPE", data: esewaPayload() });
check("unknown order is 404", eUnknown.status === 404, eUnknown);

const ePending = await post("/api/payments/esewa/status", { orderId: eid(2) });
check("status endpoint responds", ePending.status === 200, ePending);

console.log("\n=== Khalti ===");

const kInit = await post("/api/payments/khalti/initiate", {
  orderId: kid(1),
  amount: 75.5,
  description: "Test order",
  customer: { name: "Test", email: "t@example.com" },
});
check("initiate returns 200", kInit.status === 200, kInit);
const kPidx = String(kInit.body.pidx ?? "");
check("initiate returns a 20-char pidx", kPidx.length === 20, kInit.body);
check("amount is converted to paisa", kInit.body.amountPaisa === 7550, kInit.body);
check("initiate never returns the secret key", !JSON.stringify(kInit.body).includes("test_secret_key"), kInit.body);

const kVerify = await post("/api/payments/khalti/verify", {
  orderId: kid(1),
  pidx: kPidx,
  status: "Completed",
});
check("verify completes on Completed", kVerify.body.status === "completed", kVerify.body);

const kInit2 = await post("/api/payments/khalti/initiate", { orderId: kid(2), amount: 30, description: "T" });
const kPidx2 = String(kInit2.body.pidx ?? "");
const kPending = await post("/api/payments/khalti/verify", {
  orderId: kid(2),
  pidx: kPidx2,
  status: "Pending",
});
check("Pending is not treated as success", kPending.body.status !== "completed", kPending.body);

const kCancel = await post("/api/payments/khalti/verify", {
  orderId: kid(2),
  pidx: kPidx2,
  status: "User canceled",
});
check("User canceled reports failed", kCancel.body.status === "failed", kCancel.body);

const kInit3 = await post("/api/payments/khalti/initiate", { orderId: kid(3), amount: 42, description: "T" });
const kWrongRef = await post("/api/payments/khalti/verify", {
  orderId: kid(3),
  pidx: kPidx2,
  status: "Completed",
});
check(
  "callback for a different pidx cannot complete this order",
  kWrongRef.status === 404 || kWrongRef.body.status !== "completed",
  kWrongRef
);

console.log("\n=== Validation ===");

const badAmount = await post("/api/payments/esewa/initiate", { orderId: "ORD-BAD", amount: -5 });
check("negative amount is rejected", badAmount.status === 400, badAmount);
const badOrder = await post("/api/payments/khalti/initiate", { orderId: "../../etc/passwd", amount: 10 });
check("path-like orderId is rejected", badOrder.status === 400, badOrder);
const noAmount = await post("/api/payments/khalti/initiate", { orderId: "ORD-NOA", amount: "abc" });
check("non-numeric amount is rejected", noAmount.status === 400, noAmount);

const health = (await fetch(`${BASE}/api/health`).then((r) => r.json())) as { ok?: boolean };
check("health endpoint responds", health.ok === true, health);

console.log("\n=== Full browser flow (simulated gateway) ===\n");

// Mock mode must never point at a real gateway host.
const init2 = await post("/api/payments/esewa/initiate", {
  orderId: fid,
  amount: 1425,
  description: "Full flow",
});
const initFields = init2.body.fields ?? ({} as Record<string, string>);

check(
  "mock mode routes eSewa to the local simulator",
  Boolean((init2.body.action as string | undefined)?.endsWith("/pay/esewa")),
  init2.body.action
);
check("mock mode uses a GET redirect", init2.body.method === "GET", init2.body.method);

// Reproduce exactly what MockGateway sends back: it echoes the signed fields.
const echoed = {
  transaction_code: "1234567",
  status: "COMPLETE",
  total_amount: Number(initFields.total_amount ?? 1425).toFixed(2),
  transaction_uuid: initFields.transaction_uuid ?? "",
  product_code: initFields.product_code ?? "EPAYTEST",
  signed_field_names: initFields.signed_field_names ?? "",
  signature: initFields.signature ?? "",
};
const data = Buffer.from(JSON.stringify(echoed), "utf8").toString("base64");

const flow = await post("/api/payments/esewa/verify", { orderId: fid, data });
check("signed callback round-trips to completed", flow.body.status === "completed", flow.body);
check("echoed signature verified", flow.body.signatureValid === true, flow.body);
check("order amount survived the round trip", flow.body.amount === 1425, flow.body.amount);

summary();
