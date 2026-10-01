import { randomUUID } from "node:crypto";

// End-to-end proof that the eSewa integration works against the real sandbox.
// Requires the API running in sandbox mode (PAYMENTS_MODE=sandbox).
const API = process.env.API ?? "http://localhost:3001";

// Persisted rows survive across runs, so tag this run's order id.
const runTag = randomUUID().slice(0, 8);

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
};

console.log(`\n=== eSewa sandbox against ${API} ===\n`);

interface ProviderConfig {
  live: boolean;
  env: string;
  host?: string;
}
interface ApiConfig {
  mode: string;
  providers: { esewa: ProviderConfig; khalti: ProviderConfig };
}
interface InitiateResult {
  action: string;
  method: string;
  mode: string;
  transactionUuid: string;
  fields: Record<string, string>;
}
interface StatusResult {
  status?: string;
}

// 1. The server should be in sandbox mode with eSewa pointed at the RC host.
const config = (await fetch(`${API}/api/payments/config`).then((r) => r.json())) as ApiConfig;
check("mode is sandbox", config.mode === "sandbox", config);
check(
  "eSewa hits the RC test host",
  config.providers?.esewa?.host === "rc-epay.esewa.com.np",
  config.providers?.esewa
);

// 2. Initiate must return the ePay v2 field set and sign it.
const initiate = (await fetch(`${API}/api/payments/esewa/initiate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ orderId: `ORD-SBX-1-${runTag}`, amount: 1425, description: "Sandbox test" }),
}).then((r) => r.json())) as InitiateResult;

check("action is the ePay v2 form endpoint", initiate.action?.endsWith("/api/epay/main/v2/form"), initiate.action);
check("transaction uuid generated", Boolean(initiate.transactionUuid), initiate.transactionUuid);
check("amount sent as 2dp string", initiate.fields?.amount === "1425.00", initiate.fields?.amount);
check("signature present", (initiate.fields?.signature ?? "").length > 0);

for (const field of [
  "amount",
  "tax_amount",
  "total_amount",
  "transaction_uuid",
  "product_service_charge",
  "product_delivery_charge",
  "product_code",
  "success_url",
  "failure_url",
  "signed_field_names",
  "signature",
]) {
  check(`v2 field present: ${field}`, field in (initiate.fields ?? {}), field);
}
check(
  "legacy amt/pwd removed",
  !("amt" in (initiate.fields ?? {})) && !("pwd" in (initiate.fields ?? {})),
  initiate.fields
);

// 3. Post those exact fields to the real sandbox and expect a redirect.
const body = new URLSearchParams(initiate.fields as Record<string, string>).toString();
try {
  const res = await fetch(initiate.action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
    },
    body,
    redirect: "manual",
  });
  const location = res.headers.get("location") ?? "";
  check(
    "eSewa sandbox accepted the signed request (302 to its payment page)",
    res.status === 302 && location.includes("/epay"),
    { status: res.status, location }
  );
  console.log(`        redirect -> ${location.slice(0, 110)}`);
} catch (error) {
  check("posting to eSewa sandbox", false, (error as Error).message);
}

// 4. The status-check API must answer for the EPAYTEST merchant.
const statusRes = await fetch(
  "https://rc-epay.esewa.com.np/api/epay/transaction/status/?product_code=EPAYTEST&total_amount=100&transaction_uuid=240508-101430"
);
const statusJson = (await statusRes.json()) as StatusResult;
check("status check returns JSON for EPAYTEST", statusRes.ok && typeof statusJson.status === "string", statusJson);
check(
  "status check yields a real eSewa status",
  ["NOT_FOUND", "PENDING", "COMPLETE"].includes(statusJson.status ?? ""),
  statusJson
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
