/**
 * Canonical order serialisation, shared by the migration tools.
 *
 * The legacy ledger lives in SQLite (`data/orders.db`, schema v1, see
 * `server/orderStore.ts`) and the target lives in PostgreSQL. Nothing here knows
 * about either engine: a loosely typed row goes in — snake_case from a SQL client,
 * camelCase from a JSON dump, `null` or `''` for absent optional columns — and one
 * deterministic shape comes out, so the *same bytes* are produced on both sides of
 * the cutover and `compare-manifests.ts` only has to diff hashes.
 *
 * Two rules make the comparison meaningful:
 *
 *  1. **Money is never a float here.** SQLite stores `REAL`, PostgreSQL will store
 *     `numeric(12,2)`. Hashing either as a JS number would make `120.00` and
 *     `119.99999999999999` different rows when they are the same amount, so
 *     amounts are normalised to a 2-decimal string first.
 *  2. **Timestamps are always ISO-8601 UTC.** SQLite stores epoch *milliseconds*
 *     as `INTEGER`; PostgreSQL will store `timestamptz`. A timezone or unit
 *     mistake must surface here rather than as a silently rewritten `created_at`,
 *     so the epoch guard below rejects values too small to be milliseconds.
 */
import { createHash } from "node:crypto";

/** Bumped whenever the canonical shape changes; manifests record it. */
export const CANONICAL_MANIFEST_VERSION = 1;

/**
 * Column aliases, so one canonicaliser serves every producer: raw SQLite rows,
 * `psql --csv` output, and a JSON copy of the target table all normalise alike.
 */
const ALIASES = {
  orderId: ["order_id", "orderId"],
  provider: ["provider"],
  amount: ["amount"],
  description: ["description"],
  customerName: ["customer_name", "customerName"],
  customerEmail: ["customer_email", "customerEmail"],
  customerPhone: ["customer_phone", "customerPhone"],
  gatewayRef: ["gateway_ref", "gatewayRef"],
  createdAt: ["created_at", "createdAt"],
  completedAt: ["completed_at", "completedAt"],
  resultStatus: ["result_status", "resultStatus"],
  resultTransactionId: ["result_transaction_id", "resultTransactionId"],
  resultTransactionCode: ["result_transaction_code", "resultTransactionCode"],
  resultAmount: ["result_amount", "resultAmount"],
} as const;

export interface CanonicalOrder {
  orderId: string;
  provider: string;
  /** 2-decimal string, e.g. `"120.00"`. */
  amount: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  gatewayRef: string;
  /** ISO-8601 UTC, or `""` when the column is null. */
  createdAt: string;
  completedAt: string;
  resultStatus: string;
  resultTransactionId: string;
  resultTransactionCode: string;
  resultAmount: string;
}

export interface ManifestRow {
  orderId: string;
  hash: string;
}

export interface Manifest {
  version: number;
  source: string;
  generatedAt: string;
  /** Present only for SQLite sources; mirrors `schema_meta.version`. */
  schemaVersion?: string;
  rowCount: number;
  /** sha256 over every row hash, in row order. */
  checksum: string;
  countsByProvider: Record<string, number>;
  completedCount: number;
  totalOrderedAmount: string;
  totalSettledAmount: string;
  rows: ManifestRow[];
}

/** First defined, non-null value among the candidate column names. */
function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Absent, `null`, and `undefined` all canonicalise to `""`. */
function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

/**
 * Normalises an amount to a 2-decimal string. Returns `""` for absent values;
 * the caller decides whether absence is legal for that column.
 */
export function moneyString(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const amount = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(amount)) {
    throw new Error(`Not a finite amount: ${JSON.stringify(value)}`);
  }
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/**
 * Normalises a timestamp to ISO-8601 UTC. Accepts epoch milliseconds (SQLite
 * `INTEGER`, or the same digits as text) and any string `Date` can parse
 * (PostgreSQL `timestamptz`, as a dump would emit it).
 *
 * The epoch guard is deliberate: the legacy column is milliseconds, so a value
 * below 1e12 is either seconds (a unit mix-up) or a corrupt row. Both must fail
 * loudly before anything is written to PostgreSQL.
 */
export function timestampString(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Not a finite timestamp: ${String(value)}`);
    }
    if (value < 1_000_000_000_000) {
      throw new Error(
        `Timestamp ${value} is too small to be epoch milliseconds (is it seconds?). ` +
          `The legacy orders table stores created_at/completed_at in ms.`
      );
    }
    return new Date(value).toISOString();
  }

  const raw = String(value).trim();
  if (/^-?\d+$/.test(raw)) return timestampString(Number(raw));

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unparseable timestamp: ${JSON.stringify(value)}`);
  }
  return parsed.toISOString();
}

/** Maps one row of any shape to the canonical shape used for hashing. */
export function toCanonicalOrder(row: Record<string, unknown>): CanonicalOrder {
  const orderId = text(pick(row, ALIASES.orderId)).trim();
  if (!orderId) {
    throw new Error(`Row has no order_id, so it cannot be compared: ${JSON.stringify(row)}`);
  }

  const amount = moneyString(pick(row, ALIASES.amount));
  if (!amount) {
    throw new Error(`Order ${orderId} has no amount; the column is NOT NULL in both engines.`);
  }

  return {
    orderId,
    provider: text(pick(row, ALIASES.provider)),
    amount,
    description: text(pick(row, ALIASES.description)),
    customerName: text(pick(row, ALIASES.customerName)),
    customerEmail: text(pick(row, ALIASES.customerEmail)),
    customerPhone: text(pick(row, ALIASES.customerPhone)),
    gatewayRef: text(pick(row, ALIASES.gatewayRef)),
    createdAt: timestampString(pick(row, ALIASES.createdAt)),
    completedAt: timestampString(pick(row, ALIASES.completedAt)),
    resultStatus: text(pick(row, ALIASES.resultStatus)),
    resultTransactionId: text(pick(row, ALIASES.resultTransactionId)),
    resultTransactionCode: text(pick(row, ALIASES.resultTransactionCode)),
    resultAmount: moneyString(pick(row, ALIASES.resultAmount)),
  };
}

/**
 * sha256 of the canonical row. Key order is fixed by `toCanonicalOrder`, so the
 * serialisation is stable across Node versions and processes.
 */
export function rowHash(order: CanonicalOrder): string {
  return createHash("sha256").update(JSON.stringify(order), "utf8").digest("hex");
}

/** sha256 over every row hash, prefixed with its order id to pin ordering. */
export function checksumOf(rows: ManifestRow[]): string {
  return createHash("sha256")
    .update(rows.map((row) => `${row.orderId} ${row.hash}`).join("\n"), "utf8")
    .digest("hex");
}

/** Builds the manifest both sides of the cutover are compared by. */
export function buildManifest(
  orders: CanonicalOrder[],
  source: string,
  schemaVersion?: string
): Manifest {
  const rows = orders.map((order) => ({ orderId: order.orderId, hash: rowHash(order) }));

  const countsByProvider: Record<string, number> = {};
  let completedCount = 0;
  let orderedTotal = 0;
  let settledTotal = 0;

  for (const order of orders) {
    const provider = order.provider || "(empty)";
    countsByProvider[provider] = (countsByProvider[provider] ?? 0) + 1;
    if (order.completedAt) completedCount += 1;
    orderedTotal += Number(order.amount);
    if (order.resultAmount) settledTotal += Number(order.resultAmount);
  }

  return {
    version: CANONICAL_MANIFEST_VERSION,
    source,
    generatedAt: new Date().toISOString(),
    ...(schemaVersion ? { schemaVersion } : {}),
    rowCount: rows.length,
    checksum: checksumOf(rows),
    countsByProvider,
    completedCount,
    // Aggregate checks only: the per-row hashes are the authoritative comparison.
    totalOrderedAmount: moneyString(orderedTotal) || "0.00",
    totalSettledAmount: moneyString(settledTotal) || "0.00",
    rows,
  };
}

/** One canonical order per line, trailing newline included. */
export function toNdjson(orders: CanonicalOrder[]): string {
  return orders.map((order) => JSON.stringify(order)).join("\n") + (orders.length ? "\n" : "");
}

/**
 * Parses a dump written by the other side: either NDJSON (one JSON object per
 * line) or a JSON array. Blank lines are ignored so a trailing newline is fine.
 */
export function parseRowDump(contents: string): Record<string, unknown>[] {
  const trimmed = contents.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("A JSON dump must be an array of rows.");
    return parsed as Record<string, unknown>[];
  }

  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch (error) {
        throw new Error(`Line ${index + 1} is not valid JSON: ${(error as Error).message}`);
      }
    });
}
