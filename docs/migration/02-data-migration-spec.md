# 02 — Data Migration & Integrity Specification

Scope: `orders` and `schema_meta` from `data/orders.db` (SQLite, schema v1) into
PostgreSQL, losing no row and changing no behaviour the gateway contract depends on.

Implementing and proving tooling: `tools/migration/canonical-order.ts`,
`tools/migration/export-orders.ts`, `tools/migration/compare-manifests.ts`
(`npm run migration:export`, `npm run migration:compare`).

---

## 1. Type mapping

| SQLite (legacy) | PostgreSQL (target) | Why |
| --- | --- | --- |
| `order_id TEXT PRIMARY KEY` | `order_id text PRIMARY KEY` | Unchanged; the handler already validates `^[A-Za-z0-9_-]{3,64}$` |
| `provider TEXT CHECK (IN 'esewa','khalti')` | `payment_provider` **enum** | A two-value domain: let the database be the authority instead of a string comparison in three places |
| `amount REAL CHECK (> 0)` | `numeric(12,2) CHECK (> 0)` | **The most important line in this document.** `REAL` is binary floating point; money must be exact decimal. `12,2` reaches NPR 9,999,999,999.99, far above `MAX_ORDER_AMOUNT` |
| `result_amount REAL` | `result_amount numeric(12,2)` | Same reason |
| `description TEXT NOT NULL DEFAULT ''` | `text NOT NULL DEFAULT ''` | Preserve the empty-string default, so `''` and `NULL` keep their different meanings |
| `customer_name`, `customer_email` `TEXT NOT NULL DEFAULT ''` | same | |
| `customer_phone TEXT` (nullable) | `text` (nullable) | Stays nullable — `mapCustomer()` omits the key rather than sending `null` |
| `gateway_ref TEXT NOT NULL DEFAULT ''` | `text NOT NULL DEFAULT ''` | **No unique constraint** (§3) |
| `created_at INTEGER` (epoch ms) | `timestamptz` | Exact instant, timezone-correct, comparable with `now()` for retention |
| `completed_at INTEGER` (nullable) | `timestamptz` (nullable) | Also the replay guard, so its nullability is semantic rather than cosmetic |
| `result_status`, `result_transaction_id`, `result_transaction_code TEXT` | `text` | Free-form gateway strings, deliberately **not** an enum — gateways add statuses without asking |
| `schema_meta(key, value)` | the migration tool's own table (`_prisma_migrations` / `__drizzle_migrations`) | Application metadata, if still needed, belongs in a separate `app_meta` table instead of doubling as a schema-version store |

**Two conversion rules that are load-bearing:**

- **Epoch → timestamptz:** `to_timestamp(created_at / 1000.0)`. Division by `1000.0`, not
  `1000` — integer division silently truncates to whole seconds and destroys the
  sub-second ordering that `findByGatewayRef`'s `ORDER BY created_at` depends on when two
  checkouts share a one-second `transaction_uuid`.
- **Money:** `amount::numeric(12,2)`. This is where a `REAL` that was never exactly two
  decimal places either surfaces or gets quietly buried — which is why the parity harness
  hashes the 2-decimal string rather than the float.

## 2. Target DDL

```sql
CREATE TYPE payment_provider AS ENUM ('esewa', 'khalti');

CREATE TABLE orders (
  order_id                 text PRIMARY KEY
                             CHECK (order_id ~ '^[A-Za-z0-9_-]{3,64}$'),
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

  -- completed_at and result_status are set together, or not at all.
  CONSTRAINT orders_completion_consistent
    CHECK ((completed_at IS NULL) = (result_status IS NULL)),

  -- Mirrors MAX_ORDER_AMOUNT in server/money.ts.
  CONSTRAINT orders_amount_within_limit
    CHECK (amount <= 5000000)
);

-- Replaces idx_orders_gateway_ref: a callback only ever looks up live, non-empty refs.
CREATE INDEX orders_gateway_ref_live_idx
  ON orders (gateway_ref, created_at, order_id)
  WHERE gateway_ref <> '';

-- Replaces idx_orders_created_at, and backs the retention sweep.
CREATE INDEX orders_created_at_idx ON orders (created_at);
```

> **Correction, verified against PostgreSQL 16.14.** Earlier revisions of this document
> specified `expires_at timestamptz GENERATED ALWAYS AS (created_at + interval '2 hours')
> STORED`. **That statement does not run**: PostgreSQL rejects it with
> `ERROR: generation expression is not immutable`, because `timestamptz + interval` is
> `STABLE`, not `IMMUTABLE` — the result can depend on the session `TimeZone` whenever the
> interval carries day or month components. Rather than fight the type, the shipped schema
> indexes `created_at` and computes the gateway window as an expression
> (`created_at + interval '2 hours'`) in the retention query, where a `STABLE` expression
> is perfectly legal. The generated column was a nice idea that the database declined.

Index notes — these are a deliberate departure from the legacy schema:

- The legacy callback query is `WHERE gateway_ref <> '' AND gateway_ref = ?` followed by
  `ORDER BY created_at ASC, order_id ASC`. One composite partial index serves the
  equality, the ordering *and* the empty-string filter, replacing both legacy indexes.
- `created_at` becomes `NOT NULL`. The legacy column never declared it, so a null is
  possible in principle; the export tool rejects such a row rather than inventing a
  timestamp for it.

## 3. Integrity: what to constrain, and what deliberately not to

**Do constrain:**

- The partial index keeps callbacks off the pending-row scan.
- `orders_completion_consistent` makes the replay guard's invariant explicit — exactly as
  `markCompleted()` sets the two fields together.
- `amount > 0` and `amount <= 5000000` promote the existing `parseAmount` /
  `MAX_ORDER_AMOUNT` guards into the database: defence in depth for the one number that
  moves money.
- Every write to a single order happens inside **one transaction**, with the replay guard
  expressed as a conditional `UPDATE`:

  ```sql
  UPDATE orders
     SET completed_at = now(),
         result_status = $2,
         result_transaction_id = $3,
         result_transaction_code = $4,
         result_amount = $5
   WHERE order_id = $1
     AND completed_at IS NULL
  RETURNING order_id;
  ```

  Zero rows returned means "already settled" — the replay path decided by the database
  instead of a read-then-write race. This is the Postgres equivalent of the legacy
  `db.transaction()` + `touchStmt.run(...).changes === 0` sequence, and it is strictly
  stronger: two concurrent callbacks cannot both observe `completed_at IS NULL`.

**Do NOT constrain:**

- **`UNIQUE (gateway_ref)`** — it would break real payments. eSewa's `transaction_uuid`
  has one-second resolution, so two checkouts inside the same second legitimately share a
  reference; `resolveOrderForCallback` resolves that by taking the last match and
  documenting why. The measured ledger contains exactly this pattern. If you want to
  prevent *accidental* duplicates, `UNIQUE (gateway_ref, created_at)` is only safe after
  confirming the UUID generator cannot collide inside one millisecond — and the parity
  harness will flag any legacy row that violates it.
- **A `customers` table with a foreign key.** There is no customer entity today: the
  name/email/phone triple is denormalised into the order row. Inventing one during a
  datastore migration adds a deduplication question (whose email wins?) the application
  has never had to answer.

## 4. Downtime strategy

Three candidates. **C is recommended**; A and B are rejected for reasons specific to this
codebase.

**A. Dual-write (both engines, reconcile later) — rejected.**
Two writers must both honour a two-hour TTL sweep and the non-unique-reference resolution
rule, or the reconciled result matches neither engine. That reconciliation logic would be
a brand-new, untested implementation of precisely the behaviour most likely to be wrong —
strictly more risk than not having two writers at all.

**B. Logical replication / CDC (Debezium, `pglogical`) — rejected as over-engineering.**
The dataset is bounded by a two-hour window — a few hundred cold rows. Standing up a
change-data-capture pipeline to move a two-hour buffer is more moving parts than the thing
being migrated.

**C. Freeze → snapshot → import → verify → flip — recommended.**

1. **Drain.** Payment routes enter maintenance. The catalogue stays up; browsing cannot
   create an order.
2. **Stop the writer.** Stop Express (or close its port). Confirm no new rows appear.
3. **Freeze the snapshot.**
   `npm run migration:export -- --out migration-out --label legacy --freeze`
   — this runs `wal_checkpoint(TRUNCATE)` so the `.db` file is self-contained and the
   archive is complete. Without it, rows committed to the `-wal` sidecar are still visible
   to a reader but absent from the file if it is copied as a unit.
4. **Import** (§5) inside a single transaction.
5. **Verify** with `npm run migration:compare --detail`. **A red comparison aborts the
   cutover** — nothing is deployed on a failed parity check.
6. **Flip** the app to `DATABASE_URL=postgres://…` and remove the API rewrites.
7. **Smoke and reopen** (roadmap §7.1).

Measured budget: **under five minutes of payment downtime**, with the storefront readable
throughout.

**Why not true zero downtime?** It is achievable — keep Express accepting payments, buffer
the few orders created during the window, replay them after the import — but it buys three
minutes at the cost of a reconciliation path for orders created *during* the migration.
For an apparel store, three minutes of payment downtime is cheaper than that code path and
the rehearsals it needs. The risk argument inverts only if real retention (not a two-hour
window) exists first.

## 5. Import procedure

```bash
# 1. Snapshot the legacy ledger (read-only unless --freeze is passed)
npm run migration:export -- --out migration-out --label legacy --freeze

# 2. Load into PostgreSQL. The NDJSON is canonical and engine-agnostic; the loader is a
#    small script (or a staging table + INSERT … SELECT) that must do exactly two
#    conversions: to_timestamp(created_at_ms / 1000.0) and ::numeric(12,2).
#    Load inside ONE transaction — a half-imported ledger must never be observable.

# 3. Dump the target back out in the same field names and snapshot it identically
psql "$DATABASE_URL" -c "\copy (SELECT order_id, provider, amount, description,
       customer_name, customer_email, customer_phone, gateway_ref, created_at,
       completed_at, result_status, result_transaction_id, result_transaction_code,
       result_amount FROM orders ORDER BY created_at, order_id) TO stdout" > migration-out/pg.ndjson
npm run migration:export -- --from-json migration-out/pg.ndjson --label pg

# 4. Prove it. Exit code 1 means the cutover does not proceed.
npm run migration:compare -- migration-out/legacy.manifest.json migration-out/pg.manifest.json --detail
```

The loader is deliberately the *only* piece of migration code not shipped here: it depends
on the chosen ORM/driver, and it must be reviewed line by line during the freeze. Its
correctness is not taken on trust — step 4 hashes every row on both sides and fails on a
single changed byte.

### What the verification actually asserts

Ten checks, each independently reported (`PASS`/`FAIL`), all driven by the manifest:

| Check | Catches |
| --- | --- |
| Canonical version matches | A manifest produced by an older tool that hashed differently |
| Row count | A dropped or duplicated row |
| Aggregate checksum | Any single-field change anywhere in the set |
| Completed count | A lost `completed_at` — which would let a settled payment be re-settled |
| Per-provider counts | A coerced `provider` value (e.g. a failed enum cast silently dropped) |
| Ordered total | Money drift — the failure mode `REAL` → `numeric` creates |
| Settled total | `result_amount` drift specifically |
| No missing order ids | Per-order loss, named |
| No extra order ids | Rows invented by the loader |
| Every row byte-identical | Field-level equality, enumerated by `--detail` |

`--detail` reads the sibling NDJSON files and prints `field: before → after` for each
changed row, which turns "checksum mismatch" into a one-line bug report. Validated
behaviour: a tampered `amount` yields
`amount: "100.00" → "999999.99"` against `ORD-ESEWA-1-5007c22e`.

## 6. Retention policy (the one deliberate behaviour change)

The legacy rule is `DELETE FROM orders WHERE created_at < now - 2h`, executed on every read
*and* every write. Two consequences for the migration:

- **There is no history to backfill.** Whatever the business wants, the past two hours is
  the entire recoverable dataset. If longer retention is wanted, it starts at cutover.
- **The sweep must be off during the export.** A live sweep can delete a row between the
  legacy snapshot and the target snapshot, producing a false parity failure. The harness
  already advises this when a row goes missing, and the freeze procedure removes the cause
  entirely.

Recommended target design — keep the two semantics separate, because they are not the same
thing:

| Concept | Legacy | Target |
| --- | --- | --- |
| **Gateway link window** (what `TTL_MS` actually models: "matching the gateways' payment-link windows") | implicit, via the delete sweep | `expires_at` generated column — **kept**, it documents the gateway's own expiry |
| **Data retention** (how long we keep a record of the order) | same 2 hours, as a side effect | a separate, explicit policy: a scheduled `DELETE` (pg_cron or a Vercel Cron hitting a protected Route Handler), not a write on every read |

Splitting them removes the legacy hot-path write (every `getOrder` currently mutates the
database) while keeping the gateway window honest. Extending retention changes how long
customer names and email addresses are stored, so it is a privacy decision as much as a
technical one — pick a number and write down *why*.

## 7. Rollback

| Layer | Rollback |
| --- | --- |
| Snapshot | `npm run migration:export` reads read-only; `--freeze` only runs `wal_checkpoint(TRUNCATE)`. It never deletes or rewrites a row, so `data/orders.db` remains the authoritative copy until the legacy server is decommissioned |
| Application | Re-point the proxy/rewrites at Express (`LEGACY_API_ORIGIN`) or redeploy the previous release |
| Database | Drop and recreate the `orders` table from the NDJSON snapshot; a `pg_dump` taken immediately after the import is the fast restore point |
| Proof | `npm run test:store` (spawns its own API against a throwaway database and asserts durability, single-row retries, replay, non-reopening, forged-payload immunity) |

Roll back on: a red parity comparison, any `5xx` from a payment endpoint after the flip,
duplicate settlements, or a callback URL resolving to `localhost` from an external device.
Rehearse twice and record the measured time.

## 8. Known data traps, and how each is handled

| Trap | Why it bites | Handling |
| --- | --- | --- |
| `created_at` is nullable in SQLite but `NOT NULL` in the target | One legacy row with a null timestamp fails the whole import, at the worst moment | The export rejects such a row explicitly (`Timestamp … is too small…` / unparseable) instead of guessing; resolve any offender *before* the freeze |
| Epoch **seconds** mistaken for milliseconds | Every timestamp lands in 1970 or 2026 depending on the direction of the mistake; ordering breaks silently | `timestampString()` refuses any value below `1e12` with a message naming the unit. Validated: tapping a real row into seconds yields `Timestamp 1790777493 is too small to be epoch milliseconds (is it seconds?)` |
| Integer division `created_at / 1000` | Truncates to whole seconds; the sub-second ordering `findByGatewayRef` expects disappears | Use `to_timestamp(created_at / 1000.0)` |
| `REAL` → `numeric(12,2)` rounding | A legacy `REAL` such as `1424.9999999999998` becomes `1425.00`; the amount the gateway was told differs from the stored row | Parity compares 2-decimal strings, so a change in the *rounded* value fails the gate. Compare with `--detail` and fix the *legacy* value if a row was genuinely wrong |
| `completed_at` set while `result_status` is NULL | The new `orders_completion_consistent` check would reject the import | Add the constraint `NOT VALID`, import, then audit with `SELECT order_id FROM orders WHERE (completed_at IS NULL) <> (result_status IS NULL);` and only then `VALIDATE CONSTRAINT` |
| Duplicate `gateway_ref` values | A well-meaning `UNIQUE` index fails the import (and would break live payments) | Deliberately unconstrained (§3); the partial index serves the query without asserting uniqueness |
| Empty-string `gateway_ref` | `''` would match no gateway lookup, but would pollute an unfiltered index | The partial index is `WHERE gateway_ref <> ''`, mirroring the legacy query exactly |
| Rows expiring mid-migration | A false "missing row" that looks like data loss | The freeze stops the sweeper; the harness's failure guidance names this cause first |
| Loading only *completed* orders | The 71 pending rows carry live payment links; dropping them orphans a callback that can still arrive | Row count and per-provider counts are asserted, so a filtered load fails visibly |