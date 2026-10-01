-- Migration 0000 — the PostgreSQL schema that replaces data/orders.db (SQLite, schema v1).
--
-- Spec: docs/migration/02-data-migration-spec.md §2.
-- Applied by `npm run db:migrate`. Re-runnable against the same database (every
-- statement is guarded); the down path is at the bottom, commented out, because
-- dropping a ledger should never happen by accident.

-- PostgreSQL has no `IF NOT EXISTS` for CREATE TYPE (it is a syntax error), so
-- the enum is created inside a DO block that checks the catalog first. This
-- keeps the migration re-runnable, which is the whole point of `npm run db:migrate`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_provider') THEN
    CREATE TYPE payment_provider AS ENUM ('esewa', 'khalti');
  END IF;
END
$$;

-- ── The order ledger ─────────────────────────────────────────────────────────
-- Type changes from the SQLite original, each deliberate:
--   amount REAL                 -> numeric(12,2)   money is never a float
--   created_at/completed_at INT -> timestamptz     epoch ms -> a real instant
--   provider CHECK IN (...)     -> enum            the DB owns the domain
--   (no PK regex check)         -> CHECK regex     mirrors parseOrderId()
--
-- Verified deviation from earlier drafts: a generated `expires_at` column was
-- removed because `timestamptz + interval` is STABLE, not IMMUTABLE, and
-- PostgreSQL rejects it with "generation expression is not immutable". The
-- gateway window is computed as an expression in the retention query instead,
-- and `created_at` is indexed for it.
CREATE TABLE IF NOT EXISTS orders (
  order_id                 text PRIMARY KEY CHECK (order_id ~ '^[A-Za-z0-9_-]{3,64}$'),
  provider                 payment_provider NOT NULL,
  amount                   numeric(12,2) NOT NULL CHECK (amount > 0),
  description              text NOT NULL DEFAULT '',
  customer_name            text NOT NULL DEFAULT '',
  customer_email           text NOT NULL DEFAULT '',
  customer_phone           text,
  gateway_ref              text NOT NULL DEFAULT '',
  created_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  result_status            text,
  result_transaction_id    text,
  result_transaction_code  text,
  result_amount            numeric(12,2),

  -- completed_at and result_status are set together by markCompleted(), or not
  -- at all. Making that explicit is what protects the replay guard's invariant.
  CONSTRAINT orders_completion_consistent
    CHECK ((completed_at IS NULL) = (result_status IS NULL)),

  -- Mirrors MAX_ORDER_AMOUNT in src/server/money.ts.
  CONSTRAINT orders_amount_within_limit
    CHECK (amount <= 5000000)
);

-- Replaces the legacy idx_orders_gateway_ref. A callback only ever looks up live,
-- non-empty references, and always with ORDER BY created_at, order_id — so one
-- composite partial index serves the filter, the equality and the ordering.
CREATE INDEX IF NOT EXISTS orders_gateway_ref_live_idx
  ON orders (gateway_ref, created_at, order_id)
  WHERE gateway_ref <> '';

-- Replaces idx_orders_created_at, and backs the retention sweep.
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at);

-- ── The catalogue ────────────────────────────────────────────────────────────
-- Replaces src/lib/mockData.ts, which was the "whole backend" for 12 products.
-- The same row the shopper sees is now the row the checkout validates against.
CREATE TABLE IF NOT EXISTS products (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  price          numeric(12,2) NOT NULL CHECK (price > 0),
  original_price numeric(12,2)
                   CHECK (original_price IS NULL OR original_price >= price),
  description    text NOT NULL DEFAULT '',
  image          text NOT NULL,
  category       text NOT NULL,
  in_stock       boolean NOT NULL DEFAULT true,
  rating         numeric(2,1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  reviews        integer NOT NULL DEFAULT 0 CHECK (reviews >= 0),
  sizes          text[] NOT NULL DEFAULT '{}',
  colors         text[] NOT NULL DEFAULT '{}',
  tags           text[] NOT NULL DEFAULT '{}',
  sort_order     integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);

-- ── Down ─────────────────────────────────────────────────────────────────────
-- DROP TABLE products;
-- DROP TABLE orders;
-- DROP TYPE payment_provider;
