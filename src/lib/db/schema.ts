/** Drizzle table model for the PostgreSQL schema owned by `drizzle/0000_init.sql`.
 *
 * The authoritative DDL is `drizzle/0000_init.sql` — it carries the check
 * constraints, the enum type and the partial index that Drizzle's generator does
 * not express. This file exists for typed queries and to document, in one place,
 * how a column maps to a TypeScript type.
 *
 * The two mappings that matter:
 *
 *   numeric(12,2) -> string   node-postgres returns `numeric` as a string, which is
 *                             exactly what we want: money never becomes a float
 *                             anywhere in the application. Convert with `Number()`
 *                             at the API boundary and nowhere else.
 *   timestamptz   -> Date     an absolute instant; the legacy `INTEGER` epoch-ms
 *                             column is what this replaces.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Mirrors the legacy `CHECK (provider IN ('esewa','khalti'))`, promoted to a type. */
export const paymentProvider = pgEnum("payment_provider", ["esewa", "khalti"]);

export const orders = pgTable(
  "orders",
  {
    orderId: text("order_id").primaryKey(),
    provider: paymentProvider("provider").notNull(),
    /** String, deliberately — see the file header. */
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    description: text("description").notNull().default(""),
    customerName: text("customer_name").notNull().default(""),
    customerEmail: text("customer_email").notNull().default(""),
    customerPhone: text("customer_phone"),
    gatewayRef: text("gateway_ref").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Non-null is the replay guard: a set value means "already settled". */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultStatus: text("result_status"),
    resultTransactionId: text("result_transaction_id"),
    resultTransactionCode: text("result_transaction_code"),
    resultAmount: numeric("result_amount", { precision: 12, scale: 2 }),
  },
  (table) => [
    // Serves the callback lookup: equality on gateway_ref, ordered by created_at,
    // restricted to live (non-empty) references.
    index("orders_gateway_ref_live_idx")
      .on(table.gatewayRef, table.createdAt, table.orderId)
      .where(sql`${table.gatewayRef} <> ''`),
    index("orders_created_at_idx").on(table.createdAt),
  ]
);

export type OrderRow = typeof orders.$inferSelect;

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    originalPrice: numeric("original_price", { precision: 12, scale: 2 }),
    description: text("description").notNull().default(""),
    image: text("image").notNull(),
    category: text("category").notNull(),
    inStock: boolean("in_stock").notNull().default(true),
    rating: numeric("rating", { precision: 2, scale: 1 }).notNull().default("0"),
    reviews: integer("reviews").notNull().default(0),
    sizes: text("sizes").array().notNull().default([]),
    colors: text("colors").array().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("products_category_idx").on(table.category)]
);

export type ProductRow = typeof products.$inferSelect;
