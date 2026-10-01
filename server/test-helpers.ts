import { createHmac, randomUUID } from "node:crypto";

export const BASE = process.env.BASE ?? "http://localhost:3001";

/** eSewa's UAT secret, so tests can forge valid signatures independently. */
export const ESEWA_TEST_SECRET = "8gBm/:&EnhH.1/q";

export interface ApiResponse {
  ok: boolean;
  message: string;
  status?: string;
  orderId?: string;
  amount?: number;
  pidx?: string;
  transactionUuid?: string;
  signatureValid?: boolean;
  replay?: boolean;
  amountPaisa?: number;
  fields?: Record<string, string>;
  [key: string]: unknown;
}

export const post = async (path: string, body: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as ApiResponse };
};

export const sign = (message: string, secret = ESEWA_TEST_SECRET) =>
  createHmac("sha256", secret).update(message, "utf8").digest("base64");

/**
 * Every suite shares one long-lived API process and one database file, so test
 * order ids get a random tag per process. Without this a re-run would collide
 * with last run's persisted rows (and completed orders pin their state).
 */
export const runTag = randomUUID().slice(0, 8);

/** Builds a base64 callback payload the way eSewa would return it. */
export const esewaPayload = (overrides: Record<string, string> = {}) => {
  const total = overrides.total_amount ?? "100.00";
  const uuid = overrides.transaction_uuid ?? "240613-134231";
  const product = overrides.product_code ?? "EPAYTEST";
  const message = `total_amount=${total},transaction_uuid=${uuid},product_code=${product}`;
  return Buffer.from(
    JSON.stringify({
      transaction_code: overrides.transaction_code ?? "0TESTCODE",
      status: overrides.status ?? "COMPLETE",
      total_amount: total,
      transaction_uuid: uuid,
      product_code: product,
      signed_field_names: "total_amount,transaction_uuid,product_code",
      signature: overrides.signature ?? sign(message),
    }),
    "utf8"
  ).toString("base64");
};

let passed = 0;
let failed = 0;

export function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

export const summary = () => {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
};
