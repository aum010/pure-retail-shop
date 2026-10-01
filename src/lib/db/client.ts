/**
 * The one PostgreSQL connection pool.
 *
 * Three decisions, each of which exists because of a specific failure:
 *
 *  1. **`globalThis` guard.** Next.js re-evaluates modules on every hot reload in
 *     development. Without this, each reload creates another `Pool` and Postgres
 *     eventually refuses connections — a failure that only ever appears while
 *     developing, which is why it is designed in rather than discovered.
 *  2. **A bounded pool.** The legacy design was a single SQLite writer; this is
 *     ten connections, not "as many as the traffic asks for". Correctness no
 *     longer comes from the engine serialising writes (it comes from the
 *     conditional UPDATE in orders.ts), so the pool size is a throughput knob,
 *     not a safety mechanism.
 *  3. **Explicit timeouts.** SQLite had `busy_timeout = 5000`; nothing replaces it
 *     by default, and without it a slow query silently occupies a connection until
 *     the pool is exhausted.
 */
import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __pureRetailPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. It must be a PostgreSQL connection URL, e.g. " +
        "postgres://postgres@localhost:5432/pure_retail — see .env.example."
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    throw new Error(
      `DATABASE_URL must be a postgres:// connection URL. Got ${JSON.stringify(
        connectionString
      )}. If this is the legacy SQLite file path, point it at PostgreSQL instead — ` +
        "the SQLite ledger is read only by tools/migration."
    );
  }

  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    // Fail fast instead of queueing forever when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    // Per-connection guardrails; these are the SQLite `busy_timeout` analogue.
    statement_timeout: 5_000,
    lock_timeout: 2_000,
  });
}

export const pool = globalForDb.__pureRetailPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__pureRetailPool = pool;

export const db = drizzle(pool, { schema });

/** Pool health, surfaced by GET /api/health — the new failure mode to watch. */
export function poolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}
