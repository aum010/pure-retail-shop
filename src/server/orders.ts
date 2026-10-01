/**
 * Payment server configuration, adapted for the Next.js port.
 *
 * The data access layer lives in PostgreSQL now. The public seam is unchanged:
 * Store* types below keep the same meaning as `server/orderStore.ts`, and the
 * order lifecycle works the same way. The transport differences are module-local.
 */
export type PaymentProviderName = "esewa" | "khalti";

export interface StoredCustomer {
  name: string;
  email: string;
  phone?: string;
}

export interface StoredOrder {
  orderId: string;
  provider: PaymentProviderName;
  amount: number;
  description: string;
  customer: StoredCustomer;
  gatewayRef: string;
  createdAt: number;
  completedAt?: number;
  result?: {
    status: string;
    transactionId?: string;
    transactionCode?: string;
    amount: number;
  };
}

export type NewOrder = Omit<StoredOrder, "createdAt" | "completedAt" | "result">;

import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { OrderRow } from "@/lib/db/schema";
import { config } from "@/server/config";

const toNumber = (value: string | number | null | undefined, fallback = 0): number => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toEpochMs = (value: Date | string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
};

/** TTL cleanup is explicit here, unlike the legacy SQLite sweep-on-every-call. */
export const ORDER_TTL_MS = 2 * 60 * 60 * 1000;

const PROVIDERS = new Set<PaymentProviderName>(["esewa", "khalti"]);

export function toStoredOrder(row: OrderRow): StoredOrder {
  const createdAt = toEpochMs(row.createdAt) ?? 0;
  const completedAt = toEpochMs(row.completedAt);
  const provider = PROVIDERS.has(row.provider as PaymentProviderName)
    ? (row.provider as PaymentProviderName)
    : "esewa";

  return {
    orderId: row.orderId,
    provider,
    amount: toNumber(row.amount),
    description: row.description ?? "",
    customer: {
      name: row.customerName ?? "",
      email: row.customerEmail ?? "",
      ...(row.customerPhone == null || row.customerPhone === ""
        ? {}
        : { phone: row.customerPhone }),
    },
    gatewayRef: row.gatewayRef ?? "",
    createdAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(row.resultStatus == null
      ? {}
      : {
          result: {
            status: row.resultStatus,
            ...(row.resultTransactionId ? { transactionId: row.resultTransactionId } : {}),
            ...(row.resultTransactionCode ? { transactionCode: row.resultTransactionCode } : {}),
            amount: toNumber(row.resultAmount),
          },
        }),
  };
}

function toMoneyLiteral(amount: number): string {
  return amount.toFixed(2);
}

interface OrderParams {
  orderId: string;
  provider: PaymentProviderName;
  amount: number;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  gatewayRef: string;
  createdAt: number;
}

function orderParams(input: NewOrder & { createdAt: number }): OrderParams {
  return {
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
}

async function selectOrder(orderId: string): Promise<StoredOrder | null> {
  const result = await db.execute<OrderRow>(sql`
    SELECT * FROM orders WHERE order_id = ${orderId}
  `);
  const row = result.rows[0];
  return row ? toStoredOrder(row) : null;
}

export async function sweepExpired(now = Date.now()): Promise<number> {
  if (config.maintenanceMode) return 0;
  const result = await db.execute(
    sql`DELETE FROM orders WHERE created_at < to_timestamp(${(now - ORDER_TTL_MS) / 1000})`
  );
  return result.rowCount ?? 0;
}

/**
 * Create or refresh an order. Re-initiating only rewrites a *pending* row;
 * completion stays final. This mirrors `server/orderStore.ts`, except cleanup is
 * explicit rather than running before every read.
 */
export async function createOrder(input: NewOrder): Promise<NewOrder> {
  const createdAt = Date.now();
  const params = orderParams({ ...input, createdAt });
  const amount = toMoneyLiteral(params.amount);

  await db.transaction(async (tx) => {
    const touched = await tx.execute(sql`
      UPDATE orders SET
        provider = ${params.provider},
        amount = ${amount}::numeric(12,2),
        description = ${params.description},
        customer_name = ${params.customerName},
        customer_email = ${params.customerEmail},
        customer_phone = ${params.customerPhone},
        gateway_ref = ${params.gatewayRef},
        created_at = to_timestamp(${params.createdAt / 1000})
      WHERE order_id = ${params.orderId} AND completed_at IS NULL
    `);

    if ((touched.rowCount ?? 0) === 0) {
      await tx.execute(sql`
        INSERT INTO orders (
          order_id, provider, amount, description,
          customer_name, customer_email, customer_phone,
          gateway_ref, created_at
        ) VALUES (
          ${params.orderId},
          ${params.provider},
          ${amount}::numeric(12,2),
          ${params.description},
          ${params.customerName},
          ${params.customerEmail},
          ${params.customerPhone},
          ${params.gatewayRef},
          to_timestamp(${params.createdAt / 1000})
        )
        ON CONFLICT (order_id) DO NOTHING
      `);
    }
  });

  return input;
}

export async function getOrder(orderId: string): Promise<StoredOrder | null> {
  return selectOrder(orderId);
}

export async function findByGatewayRef(ref: string): Promise<StoredOrder[]> {
  if (!ref) return [];
  const result = await db.execute<OrderRow>(sql`
    SELECT * FROM orders
    WHERE gateway_ref <> '' AND gateway_ref = ${ref}
    ORDER BY created_at ASC, order_id ASC
  `);
  return result.rows.map(toStoredOrder);
}

export async function markCompleted(
  orderId: string,
  result: StoredOrder["result"]
): Promise<void> {
  await db.execute(sql`
    UPDATE orders SET
      completed_at = now(),
      result_status = ${result?.status ?? null},
      result_transaction_id = ${result?.transactionId ?? null},
      result_transaction_code = ${result?.transactionCode ?? null},
      result_amount = ${result?.amount == null ? null : toMoneyLiteral(result.amount)}::numeric(12,2)
    WHERE order_id = ${orderId} AND completed_at IS NULL
  `);
}

/**
 * Find the order an incoming gateway callback belongs to.
 *
 * Server behavior matches `resolveOrderForCallback`: gateway references may be
 * shared by several orders, so exact `(gateway_ref, created_at, order_id)`
 * ordering is preserved, and a supplied order id must have actually claimed the
 * reference. When no explicit order id is available, the newest candidate wins.
 */
export async function resolveOrderForCallback(
  orderId: string | undefined,
  gatewayRef: string | undefined
): Promise<StoredOrder | null> {
  const candidates = gatewayRef ? await findByGatewayRef(gatewayRef) : [];

  if (candidates.length) {
    if (orderId) return candidates.find((order) => order.orderId === orderId) ?? null;
    return candidates[candidates.length - 1];
  }

  if (orderId) return selectOrder(orderId);
  return null;
}

export const newPublicId = () => randomUUID();

export async function countOrders(): Promise<number> {
  const result = await db.execute<{ n: string | number }>(
    sql`SELECT COUNT(*) AS n FROM orders`
  );
  return toNumber(result.rows[0]?.n, 0);
}

/** Tests only. Never called by production routes. */
export async function clearAllOrdersForTests(): Promise<void> {
  await db.execute(sql`DELETE FROM orders`);
}

/** Flushes queued writes. PostgreSQL guarantees durability without WAL rotation. */
export async function checkpointDatabase(): Promise<void> {
  await db.execute(sql`SELECT pg_switch_wal()`);
}

export function describeStore() {
  return {
    backend: "postgres" as const,
    databaseUrl: config.databaseUrl,
    schema: 1,
  };
}
