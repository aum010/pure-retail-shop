/**
 * Persistence regression checks: prove the SQL ledger actually does what an
 * in-memory Map cannot — rows survive a full process restart, and a shopper's
 * retry storm resolves to exactly one live row.
 *
 * This suite starts its own API process against a throwaway database file, so
 * unrelated servers (and the shared dev database) keep running untouched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, summary, runTag } from "./test-helpers.js";

export const STORE_CASES = [
  "a row created before a restart is still readable after it",
  "a second initiate on the same order id refreshes — not duplicates — the row",
  "a second verify on a completed order replays instead of double-settling",
  "a completed order cannot be reopened by re-initiating",
  "a forged payload cannot rewrite a settled row's stored result",
];

const orderId = (suffix: string) => `ORD-PERSIST-${suffix}-${runTag}`;
const scratch = mkdtempSync(join(tmpdir(), "pure-retail-db-"));

let child: ChildProcess | null = null;

interface PostResult {
  status: number;
  body: Record<string, unknown>;
}

function postJson(port: number, path: string, body: unknown): Promise<PostResult> {
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  }));
}

async function getJson(port: number, path: string): Promise<PostResult> {
  const res = await fetch(`http://localhost:${port}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function waitForHealth(port: number) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // Not up yet; keep polling below the deadline.
    }
    if (Date.now() > deadline) throw new Error(`API on :${port} never came up`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Spawns `node --import tsx` rather than `npx tsx`: `npx` is a `.cmd` shim that
 * Node cannot execute without spawning a shell, and the shell would swallow the
 * signal we send on shutdown, leaving the port occupied for the next run.
 */
async function startApi(port: number) {
  child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: { ...process.env, PORT: String(port), DATABASE_URL: join(scratch, "orders.db") },
  });
  await waitForHealth(port);
}

function stopApi() {
  return new Promise<void>((resolve) => {
    if (!child) return resolve();
    const dying = child;
    child = null;
    dying.once("exit", () => resolve());
    dying.kill();
    setTimeout(resolve, 5000).unref();
  });
}

async function initiate(port: number, id: string, amount = 100) {
  return postJson(port, "/api/payments/esewa/initiate", {
    orderId: id,
    amount,
    description: "Persistence check",
  });
}

/** Rebuilds the callback payload exactly as the in-page checkout would. */
function payloadFor(body: Record<string, unknown>, amount?: number) {
  const fields = (body.fields ?? {}) as Record<string, string>;
  const total = amount ?? Number(fields.total_amount ?? 100);
  return Buffer.from(
    JSON.stringify({
      transaction_code: "0PERSIST",
      status: "COMPLETE",
      total_amount: Number(total).toFixed(2),
      transaction_uuid: fields.transaction_uuid,
      product_code: fields.product_code ?? "EPAYTEST",
      signed_field_names: fields.signed_field_names,
      signature: fields.signature,
    }),
    "utf8"
  ).toString("base64");
}

const settle = (port: number, id: string, data: string) =>
  postJson(port, "/api/payments/esewa/verify", { orderId: id, data });

console.log("\n=== Order persistence (SQL) ===\n");

try {
  // Never taken from a stable pool: two concurrent runs must not share a port.
  const port = 3191 + (Number.parseInt(runTag.slice(0, 4), 16) % 300);
  await startApi(port);

  // 1. Initiate, then kill the process: the row must still be there.
  const first = orderId("A1");
  const created = await initiate(port, first, 100);
  check("initiate writes a durable row", created.status === 200, created.body);
  const file = join(scratch, "orders.db");
  const { existsSync, statSync } = await import("node:fs");
  const durable =
    statSync(file).size > 0 && existsSync(file + "-wal") && existsSync(file + "-shm");
  check("the store is a real SQLite file with a WAL, not a Map", durable, file);
  await stopApi();
  await startApi(port);
  const resurrected = await settle(port, first, payloadFor(created.body));
  check(
    STORE_CASES[0],
    resurrected.body.status === "completed" && resurrected.body.amount === 100,
    resurrected.body
  );

  // 2. Re-initiating refreshes the one row rather than adding another.
  const dup = orderId("A2");
  await initiate(port, dup, 100);
  await initiate(port, dup, 100);
  const rows = await getJson(port, `/api/orders/${dup}`);
  const record = (rows.body.order ?? {}) as { orderId?: string; amount?: number };
  check(
    STORE_CASES[1],
    rows.body.ok === true && record.orderId === dup && record.amount === 100,
    rows.body
  );

  // 3. Double verify: a replay, never a second settlement.
  const replayTarget = orderId("A3");
  const verifying = await initiate(port, replayTarget, 120);
  const once = await settle(port, replayTarget, payloadFor(verifying.body));
  const twice = await settle(port, replayTarget, payloadFor(verifying.body));
  check("first verify completes", once.body.status === "completed", once.body);
  check(
    STORE_CASES[2],
    twice.body.status === "completed" && twice.body.replay === true,
    twice.body
  );

  // 4. Re-initiating a completed order must not resurrect it as pending.
  const pinned = await initiate(port, replayTarget, 120);
  const settled = await settle(port, replayTarget, payloadFor(pinned.body));
  check(
    STORE_CASES[3],
    settled.body.replay === true && settled.body.status === "completed",
    settled.body
  );

  // 5. A different amount presented for the settled order cannot rewrite the
  // stored result: the replay guard answers before any amount comparison, so
  // the recorded 120.00 stands.
  const forged = await settle(port, replayTarget, payloadFor(verifying.body, 999));
  check(
    STORE_CASES[4],
    forged.body.replay === true &&
      forged.body.status === "completed" &&
      forged.body.amount === 120,
    forged.body
  );
} finally {
  await stopApi();
  rmSync(scratch, { recursive: true, force: true });
}

summary();
