import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * better-sqlite3 loads its native binding with plain `require`, which has no
 * TypeScript declarations, so the tiny interface below describes only the calls
 * this store makes.
 */

/**
 * better-sqlite3 ships its own JavaScript but no TypeScript declarations, so
 * the constructor is pulled in through `require` and described with the small
 * surface below. Only the calls this store actually makes are modeled.
 */
interface Statement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  pragma(pragma: string): void;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

type DatabaseConstructor = new (filename: string) => SqliteDatabase;

const Database = require("better-sqlite3") as DatabaseConstructor;
import { config, projectRoot } from "./config.js";

export interface StoredOrder {
  orderId: string;
  provider: "esewa" | "khalti";
  /** Amount in major units (rupees), exactly what the server charged. */
  amount: number;
  description: string;
  customer: { name: string; email: string; phone?: string };
  /** eSewa transaction uuid or Khalti pidx. */
  gatewayRef: string;
  createdAt: number;
  /** Set once verified so a replayed callback cannot clear the cart twice. */
  completedAt?: number;
  result?: { status: string; transactionId?: string; transactionCode?: string; amount: number };
}

/**
 * SQLite-backed order ledger.
 *
 * Every initiate and every completed verification is a durable row, so late
 * callbacks (or an order recovered after a restart) can still be matched
 * against the exact amount the server charged. Concurrency is serialized
 * through a single connection with one writer transaction per mutation, so a
 * retry storm cannot interleave two writes to the same order.
 *
 * `DATABASE_URL` selects the file (default: `data/orders.db` under the project
 * root). Its parent directory is created on boot; the file itself is
 * environment state and therefore git-ignored.
 */
export const databasePath = (() => {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return path.resolve(projectRoot, fromEnv);
  return path.join(projectRoot, "data", "orders.db");
})();

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
// Busy-wait instead of throwing on lock contention, and WAL so readers never
// block the single writer.
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

export const DATABASE_SCHEMA_VERSION = 1;

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('esewa', 'khalti')),
    amount REAL NOT NULL CHECK (amount > 0),
    description TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    customer_phone TEXT,
    gateway_ref TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    result_status TEXT,
    result_transaction_id TEXT,
    result_transaction_code TEXT,
    result_amount REAL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_gateway_ref ON orders (gateway_ref);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
`);

db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
  String(DATABASE_SCHEMA_VERSION)
);

/** Orders expire after 2h, matching the gateways' payment-link windows. */
const TTL_MS = 2 * 60 * 60 * 1000;

const sweepStmt = db.prepare(`DELETE FROM orders WHERE created_at < ?`);

/** Removes rows past the TTL so the index stays lean. */
function sweep() {
  sweepStmt.run(Date.now() - TTL_MS);
}

interface OrderRow {
  order_id: string;
  provider: "esewa" | "khalti";
  amount: number;
  description: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  gateway_ref: string;
  created_at: number;
  completed_at: number | null;
  result_status: string | null;
  result_transaction_id: string | null;
  result_transaction_code: string | null;
  result_amount: number | null;
}

const mapCustomer = (row: OrderRow): StoredOrder["customer"] => ({
  name: row.customer_name,
  email: row.customer_email,
  ...(row.customer_phone == null ? {} : { phone: row.customer_phone }),
});

/** Maps one row to the shape the API handlers already speak. */
function toStoredOrder(row: OrderRow): StoredOrder {
  return {
    orderId: row.order_id,
    provider: row.provider,
    amount: row.amount,
    description: row.description,
    customer: mapCustomer(row),
    gatewayRef: row.gateway_ref,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    result:
      row.result_status === null
        ? undefined
        : {
            status: row.result_status,
            transactionId: row.result_transaction_id ?? undefined,
            transactionCode: row.result_transaction_code ?? undefined,
            amount: row.result_amount ?? 0,
          },
  };
}

export type NewOrder = Omit<StoredOrder, "createdAt" | "completedAt" | "result">;

const getOrderStmt = db.prepare(`SELECT * FROM orders WHERE order_id = ?`);

/** Re-initiating only ever rewrites a *pending* order; a completion is final. */
const touchStmt = db.prepare(`
  UPDATE orders SET
    provider = @provider,
    amount = @amount,
    description = @description,
    customer_name = @customerName,
    customer_email = @customerEmail,
    customer_phone = @customerPhone,
    gateway_ref = @gatewayRef,
    created_at = @createdAt
  WHERE order_id = @orderId AND completed_at IS NULL
`);

interface OrderParams {
  orderId: string;
  provider: NewOrder["provider"];
  amount: number;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  gatewayRef: string;
  createdAt: number;
}

const insertStmt = db.prepare(`
  INSERT INTO orders (
    order_id, provider, amount, description,
    customer_name, customer_email, customer_phone,
    gateway_ref, created_at
  ) VALUES (
    @orderId, @provider, @amount, @description,
    @customerName, @customerEmail, @customerPhone,
    @gatewayRef, @createdAt
  )
`);

const upsertOrder = db.transaction(
  (input: NewOrder & { createdAt: number }): void => {
    const params: OrderParams = {
      orderId: input.orderId,
      provider: input.provider,
      amount: input.amount,
      description: input.description,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      customerPhone: input.customer.phone ?? null,
      gatewayRef: input.gatewayRef,
      createdAt: input.createdAt,
    };
    if (touchStmt.run(params).changes === 0) {
      const existing = getOrderStmt.get(input.orderId) as OrderRow | undefined;
      if (!existing) insertStmt.run(params);
    }
  }
);

export function createOrder(input: NewOrder) {
  sweep();
  upsertOrder({ ...input, createdAt: Date.now() });
  return input;
}

export function getOrder(orderId: string) {
  sweep();
  const row = getOrderStmt.get(orderId) as OrderRow | undefined;
  return row ? toStoredOrder(row) : null;
}

const findByGatewayRefStmt = db.prepare(`
  SELECT * FROM orders
  WHERE gateway_ref <> '' AND gateway_ref = ?
  ORDER BY created_at ASC, order_id ASC
`);

/**
 * Every live order that claimed this reference, oldest first. Gateway
 * references are not unique across orders: eSewa's transaction uuid has
 * one-second resolution, so two checkouts started inside the same second share
 * one.
 */
export function findByGatewayRef(ref: string): StoredOrder[] {
  if (!ref) return [];
  sweep();
  return (findByGatewayRefStmt.all(ref) as OrderRow[]).map(toStoredOrder);
}

const markCompletedStmt = db.prepare(`
  UPDATE orders SET
    completed_at = @completedAt,
    result_status = @status,
    result_transaction_id = @transactionId,
    result_transaction_code = @transactionCode,
    result_amount = @amount
  WHERE order_id = @orderId
`);

export function markCompleted(orderId: string, result: StoredOrder["result"]) {
  sweep();
  markCompletedStmt.run({
    orderId,
    completedAt: Date.now(),
    status: result?.status ?? null,
    transactionId: result?.transactionId ?? null,
    transactionCode: result?.transactionCode ?? null,
    amount: result?.amount ?? null,
  });
}

/**
 * Resolves the order for an incoming callback.
 *
 * The callback carries no trustworthy order id: eSewa omits it entirely, and
 * Khalti's `purchase_order_id` is echoed from client-supplied data. The
 * gateway's own reference is therefore authoritative. When the client also
 * supplies an orderId it must be one that actually claimed that reference,
 * otherwise a mismatched pair would silently mark a different order as paid.
 *
 * With no orderId (the real eSewa callback), the most recent order holding the
 * reference wins, which is the best available answer when two checkouts shared
 * a one-second uuid.
 */
export function resolveOrderForCallback(orderId: string | undefined, gatewayRef: string | undefined) {
  const candidates = gatewayRef ? findByGatewayRef(gatewayRef) : [];

  if (candidates.length) {
    if (orderId) return candidates.find((order) => order.orderId === orderId) ?? null;
    return candidates[candidates.length - 1];
  }

  // No reference match: only trust the orderId when the reference is absent or
  // simply unknown to us (e.g. eSewa callbacks recovered by uuid).
  if (orderId) return getOrder(orderId);
  return null;
}

export const newPublicId = () => randomUUID();

/** Number of stored rows, used by the persistence checks. */
export function countOrders() {
  return (db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as { n: number }).n;
}

/** Drops every row; tests only, never called by the API. */
export function clearAllOrdersForTests() {
  db.exec(`DELETE FROM orders`);
}

/** Flushes the write-ahead log so a hard crash cannot lose committed rows. */
export function checkpointDatabase() {
  db.pragma("wal_checkpoint(TRUNCATE)");
}

/** For logging and admin inspection; nothing else reads it. */
export function describeStore() {
  return {
    backend: "sqlite" as const,
    path: databasePath,
    schema: DATABASE_SCHEMA_VERSION,
  };
}

