/**
 * Loads the legacy ledger snapshot into PostgreSQL.
 *
 * Phase 4 loader: takes the `<label>.ndjson` produced by
 * `npm run migration:export -- --out migration-out --label legacy` and inserts
 * every row in a single transaction, converting epoch milliseconds to
 * `timestamp with time zone` and money strings to `numeric(12,2)`.
 *
 * A half-inserted ledger is never observable: the whole load happens inside
 * one transaction and rolls back on the first failure.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { parseRowDump, toCanonicalOrder } from "../tools/migration/canonical-order.js";

function usage(): never {
  console.log(`
Usage:
  tsx scripts/db-import-orders.ts --from <legacy.ndjson>

  Loads the canonical NDJSON dump into the orders table in one transaction.
  The table must be empty; refusing to mix two ledgers is the safety property.
`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const key = `--${name}`;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === key) return argv[i + 1];
    if (argv[i]?.startsWith(`${key}=`)) return argv[i].slice(key.length + 1);
  }
  return undefined;
}

const from = arg("from");
if (!from) usage();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

for (const name of [".env.local", ".env"]) {
  const file = path.join(projectRoot, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = trimmed.slice(equals + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const rows = parseRowDump(readFileSync(from!, "utf8")).map(toCanonicalOrder);

const toTimestamp = (iso: string): string | null => (iso === "" ? null : iso);
const toMoney = (amount: string): string => amount;

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");

  const existing = await client.query<{ n: string }>("SELECT COUNT(*) AS n FROM orders");
  if (Number(existing.rows[0]?.n ?? 0) > 0) {
    throw new Error(
      `orders already holds ${existing.rows[0]?.n} rows. Refusing to mix two ledgers. ` +
        "Pass the dump of the live table to migration:export for comparison, or clear " +
        "the target and re-run."
    );
  }

  for (const order of rows) {
    await client.query(
      `INSERT INTO orders (
         order_id, provider, amount, description,
         customer_name, customer_email, customer_phone,
         gateway_ref, created_at, completed_at,
         result_status, result_transaction_id, result_transaction_code, result_amount
       ) VALUES (
         $1, $2::payment_provider, $3::numeric(12,2), $4,
         $5, $6, NULLIF($7, ''),
         $8, $9::timestamptz, $10::timestamptz,
         NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''), NULLIF($14, '')::numeric(12,2)
       )`,
      [
        order.orderId,
        order.provider,
        toMoney(order.amount),
        order.description,
        order.customerName,
        order.customerEmail,
        order.customerPhone,
        order.gatewayRef,
        toTimestamp(order.createdAt),
        toTimestamp(order.completedAt),
        order.resultStatus,
        order.resultTransactionId,
        order.resultTransactionCode,
        order.resultAmount === "" ? null : order.resultAmount,
      ]
    );
  }

  await client.query("COMMIT");
  console.log(`[db:import-orders] loaded ${rows.length} rows from ${from}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
