# 04 — Full-Stack Integration Architecture (Next.js App Router ↔ PostgreSQL)

## 1. Target application structure

```
app/
  layout.tsx                        # root: fonts, Tailwind, Toaster/Sonner providers
  (storefront)/
    layout.tsx                      # replaces <Route element={<Layout />}>: header, footer, cart badge
    page.tsx                        # /            (was src/pages/Home.tsx)
    shop/
      page.tsx                      # /shop        (was src/pages/Shop.tsx) — reads searchParams
    product/
      [id]/page.tsx                 # /product/:id (was src/pages/ProductDetail.tsx)
    cart/page.tsx                   # /cart        — "use client" (Zustand)
    checkout/page.tsx               # /checkout    — "use client"
    confirmation/page.tsx           # /confirmation
    pay/[provider]/page.tsx         # /pay/:provider — dev simulator, 404 in live mode
  not-found.tsx                     # was src/pages/NotFound.tsx
  payment/callback/
    route.ts                        # GET + POST — eSewa redirects with GET, posts forms, both land here
  api/
    health/route.ts                 # GET  /api/health
    orders/[orderId]/route.ts       # GET  /api/orders/:orderId
    payments/config/route.ts        # GET  /api/payments/config
    payments/esewa/initiate/route.ts
    payments/esewa/verify/route.ts
    payments/esewa/status/route.ts
    payments/khalti/initiate/route.ts
    payments/khalti/verify/route.ts
lib/
  payments/esewa.ts                 # lifted verbatim from server/esewa.ts
  payments/khalti.ts                # lifted verbatim from server/khalti.ts
  payments/money.ts                 # lifted verbatim from server/money.ts
  payments/origin.ts                # replaces publicOrigin(req) using headers()
  config.ts                         # lifted from server/config.ts, minus dotenv
  db/client.ts                      # pg Pool singleton (globalThis-guarded)
  db/orders.ts                      # the ported orderStore: SAME eight exported functions
  store.ts                          # Zustand, unchanged including the persist key
  currency.ts, utils.ts             # unchanged
components/
  ui/…                              # the 20 primitives actually used
  Layout.tsx, Header.tsx, Footer.tsx, ProductCard.tsx   # unchanged
```

Rules that keep the port honest:

- **URL parity is a requirement, not a nicety.** Every path above is identical to the
  React Router path it replaces, because `/payment/callback` is registered with both
  gateways and because bookmarked product URLs must not 404.
- `lib/db/orders.ts` exports the **same eight functions** as `server/orderStore.ts`. If the
  API layer ever needs to change because of the store, the seam was violated.
- `import "server-only"` at the top of `lib/config.ts`, `lib/db/*` and `lib/payments/*`, so
  a stray client import fails at build time instead of shipping `ESEWA_SECRET_KEY`.

## 2. RSC vs Route Handlers vs Server Actions

The decision rule, applied consistently:

| Caller | Mechanism | Reason |
| --- | --- | --- |
| Our own UI reading data | **Server Component** (`await query()`) | No HTTP hop, no client bundle, no loading spinner, no API to version |
| Our own UI mutating data | **Server Action** | Progressive enhancement, one round trip, no hand-written fetch |
| Anything else: gateways, test suites, uptime probes, mobile clients | **Route Handler** | A stable JSON contract with a real URL, reachable by `curl` and by `fetch` from outside the app |

Applied to this codebase:

| Endpoint | Mechanism | Why not the alternative |
| --- | --- | --- |
| Catalogue (`shop`, `product/[id]`) | Server Component + direct query | It is our own read path; an API route here would be a hop we wrote ourselves |
| `/api/health` | Route Handler | Probes and `test-store.ts` fetch it |
| `/api/orders/[orderId]` | Route Handler | `test-store.ts` asserts on its JSON |
| `/api/payments/config` | Route Handler | The storefront fetches it, and it is a public mode report |
| `…/esewa/initiate`, `…/khalti/initiate` | Route Handler | Returns an exact JSON shape (`action`/`fields`/`pidx`/`amountPaisa`) that `src/lib/payments/api.ts` already parses, and that `test-api.ts` asserts field by field |
| `…/verify`, `…/status` | Route Handler | Same contract; `test-inpage.ts` and `test-api.ts` drive them directly |
| Add-to-cart, quantity changes | *No server call at all* | Cart stays client-side in Zustand (there is no authentication to attach it to) |
| `/payment/callback` | Route Handler, **never a Server Action** | See below |
| Place order against the catalogue price | Server-side validation on the existing initiate route | The amount must stay server-decided, as it is today |

**Why the callback cannot be a Server Action.** React's Server Actions reject
cross-origin POSTs — a deliberate CSRF defence. eSewa's return is a browser navigation and
a form POST originating from `epay.esewa.com.np`, so a Server Action endpoint would reject
exactly the traffic it exists to receive. The callback must be a plain Route Handler
exporting `GET` and `POST`; it then verifies server-side, and redirects to
`/confirmation` with the result. (Risk **R-04**.)

## 3. ORM selection — ADR

### Decision criteria, weighted for *this* application

| # | Criterion | Why it matters here |
| --- | --- | --- |
| 1 | **Explicit control of money and time types** | `numeric` must not silently become a JS `number`; `timestamptz` must not lose its zone. Correctness of these two types is the entire reason for leaving SQLite |
| 2 | **Reviewable, reversible SQL migrations** | A live cutover is being performed: the migration that creates the table must be readable, diffable and revertible by the person doing the freeze |
| 3 | **Raw-SQL escape hatch** | The order store is five hand-written queries. A layer that fights hand-written SQL is worse than no layer |
| 4 | **Serverless-safe runtime behaviour** | Payment routes run on the Node runtime but must not exhaust connections or require a bundled engine binary |
| 5 | **Type safety at the boundary** | Row → API response mapping (`toStoredOrder`, `mapCustomer`) is where the money contract leaks |
| 6 | **Fit with the existing code** | Hand-written SQL plus a thin mapping function. No repository pattern, no models, no relations |

### Options

| | **Drizzle** (recommended) | Prisma | Raw `pg` | Kysely |
| --- | --- | --- | --- | --- |
| Schema definition | TypeScript, maps 1:1 to DDL | Own DSL (`schema.prisma`) | hand-written SQL | TypeScript, query-builder oriented |
| Money (`numeric`) | `numeric()` **is** `numeric`; the driver returns a **string** by default, so no float ever appears | `Decimal` object — easy to leak into JSON, easy to `.toNumber()` by accident | `string` (default), explicit | `string` |
| Timestamps | `timestamp({ withTimezone: true })` → `timestamptz`, with an explicit `mode: 'date' \| 'string'` | `DateTime` → JS `Date`; timezone handling is implicit, a classic off-by-hours source | explicit | explicit |
| Migration output | plain `.sql` you can read, edit and drop — matches the data spec exactly (partial index, `GENERATED ALWAYS AS`, `NOT VALID` + `VALIDATE`) | generated SQL, harder to hand-tune for those DDL features | you write them | you write them |
| Migration history | journal table | `_prisma_migrations` (checksums, timestamps — richer) | none | own |
| Raw SQL | first-class (`sql\`\``), composes inside transactions | `$queryRaw`, usable, less ergonomic | it *is* raw | decent |
| Runtime | pure JS | historically an engine binary; the driver-adapter direction changes this, which is a moving target | pure JS | pure JS |
| Pooling (pgBouncer transaction mode) | fine | needs prepared statements disabled | fine | fine |
| Tooling | `drizzle-kit` (generate / push / studio) | Prisma Studio — best DX of the four | none | none |

### Recommendation: **Drizzle**, with plain SQL for the store's critical queries

The reasoning is specific, not generic:

1. **Criterion 1 is the tiebreaker.** The purpose of this migration is to stop storing money
   as a float and timestamps as an untyped integer. Drizzle is the option where `numeric`
   stays a string end to end, so `amount` can only reach the API response through an
   explicit conversion at one boundary — the discipline `toStoredOrder()` already applies by
   hand.
2. **Criterion 2 is a hard requirement.** The target schema needs a partial index
   (`WHERE gateway_ref <> ''`), a `GENERATED ALWAYS AS … STORED` column, and a `CHECK` added
   `NOT VALID` then `VALIDATE`d. Those are hand-written statements by nature; a tool that
   treats SQL as an output artefact of its own model will fight them.
3. **Criterion 3 describes the existing code.** Five queries and one mapping function.
   Handing them to Drizzle's `sql` template preserves the current shape exactly: SQL in one
   file, mapping in one function.
4. **Prisma is a legitimate alternative** if the team values the higher-level client,
   `prisma migrate`'s applied-migration bookkeeping and Studio enough to accept
   `Decimal`-at-the-boundary handling plus hand-tuned SQL for those two DDL features. It is a
   preference difference, not a correctness one — provided the `Decimal`/`Date` conversions
   are pinned down by tests.
5. **Revisit if**: the schema grows real relations at scale (Prisma's relation handling
   starts to win), or the team adopts an edge-runtime data path (re-evaluate driver-adapter
   support for both).

**Consequences accepted with Drizzle:** no Studio a non-engineer can browse; migrations are
explicit, so someone must write them; and `drizzle-kit generate` will not infer the partial
index or the generated column, so those live in a hand-written migration file. Costs this
project should happily pay.

## 4. Connection pooling and the Node runtime

```ts
// lib/db/client.ts
import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// Next.js dev HMR re-evaluates modules. Without this guard, every hot reload creates
// another Pool and Postgres eventually refuses connections — a failure that appears
// only in development, which is why it is designed in rather than discovered.
const globalForDb = globalThis as unknown as { __pureRetailPool?: Pool };

const pool =
  globalForDb.__pureRetailPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL, // now a postgres:// URL, not a file path
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__pureRetailPool = pool;

export const db = drizzle(pool);
```

Decisions that go with it:

- **`export const runtime = "nodejs"` on every payment route.** The Edge runtime has no
  `node:crypto` (which `esewa.ts` uses for HMAC) and no `pg` socket access. Set it
  explicitly rather than relying on the default, so a later config change cannot move a
  money route to an incompatible runtime.
- **`max` connections, not "as many as possible".** The whole legacy design was a
  single-connection SQLite writer. Ten pooled connections is generous for this traffic and
  keeps the database's own `max_connections` budget intact for migrations and admin work.
- **`pgbouncer` in transaction mode is safe here** because nothing keeps a connection
  across statements. Note the corollary: named prepared statements must stay off
  (Drizzle's default) when fronting with pgbouncer in transaction mode.
- **A single-connection `max: 1` is *not* a substitute for the old single-writer model.**
  The old model got correctness from SQLite serialising every write; the new one gets it
  from the conditional `UPDATE` and the transaction (§3 of the data spec). Correctness must
  move with the engine, not stay behind as a pool setting.

## 5. Transactions, concurrency and idempotency

Three invariants, each with a Postgres mechanism rather than a hope:

| Invariant | Mechanism |
| --- | --- |
| A settled order can never be re-settled | `UPDATE … WHERE order_id = $1 AND completed_at IS NULL RETURNING order_id` — zero rows means "already settled". Two concurrent callbacks cannot both match, so the replay decision is made by the database, not by application timing |
| Re-initiating cannot reopen a completed order | The touch-then-insert transaction with its `completed_at IS NULL` guard, plus `ON CONFLICT (order_id) DO NOTHING` on the insert so a concurrent create is a no-op instead of a unique-violation error |
| A failed write leaves nothing behind | Every multi-statement mutation runs in one transaction (`db.transaction`), so a crash between the touch and the insert cannot leave a half-updated order |

Isolation: the default **`READ COMMITTED`** is sufficient and deliberate. The conditional
`UPDATE` is atomic on its own, so no `SERIALIZABLE` retry loop is needed; introducing one
would add a retry path to the payment handler, which is exactly the kind of complexity that
turns a settlement bug into an intermittent settlement bug.

Timeouts to set explicitly, because the legacy code had `busy_timeout = 5000` and nothing
replaces it by default:

```sql
SET LOCAL statement_timeout = '5s';    -- per payment transaction
SET LOCAL lock_timeout = '2s';         -- fail fast rather than pile up
```

This is the direct translation of SQLite's `busy_timeout`, and without it a slow query
silently occupies a pooled connection until the pool is exhausted.

## 6. Caching and revalidation

| Data | Mode | Rule |
| --- | --- | --- |
| Order status, `/api/orders/[orderId]`, payments config | **Never cached** | `export const dynamic = "force-dynamic"` (or `noStore()`). A cached order status is a wrong answer about money |
| Catalogue (products, categories) | Cached, tagged | `unstable_cache`/`fetch` with `next: { tags: ["products"] }`, revalidated by `revalidateTag("products")` on any catalogue write |
| Product detail pages | ISR-able | `revalidate` plus the same tag; the price shown must come from the same row the checkout validates against |
| Static shell (layout, nav) | Static | Nothing dynamic about it |

The one that matters: **the price the shopper sees and the price the server charges must
come from the same row.** In the legacy app they come from two different places
(`src/lib/mockData.ts` for display, the client-supplied `amount` for charging, which the
server merely validates and rounds). Once products live in PostgreSQL, the checkout path
must re-read the price server-side and confirm it, or the migration has kept the bug while
changing the database under it.

## 7. Origin derivation, environment and the client/server boundary

**Return URLs (invariant 5).** `publicOrigin()` must be reimplemented from request headers,
not from a hard-coded value:

```ts
// lib/payments/origin.ts
export async function publicOrigin(): Promise<string> {
  const configured = process.env.PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;

  return "http://localhost:3000"; // dev fallback only
}
```

Two things to preserve deliberately: `PUBLIC_APP_URL` still wins when set, and
`x-forwarded-host` is read **before** `host`, exactly as the Express version did — because
the legacy Vite proxy forwarded the original host for this reason. Verify with a real
device on the LAN (roadmap §6.1) rather than trusting a localhost test, which is the one
scenario where a broken implementation still looks correct.

**Environment.** Next.js loads `.env.local`, so the `dotenv` dependency and
`import "dotenv/config"` both go away. The migration's rule of thumb: if a variable was
`VITE_*`, it is public and becomes `NEXT_PUBLIC_*`; if it was server-only (everything in
`server/config.ts`), it must never gain that prefix, and the module that reads it must be
`import "server-only"` so a mistaken client import fails the build.

**Secrets.** Keep `assertLiveSecretsPresent()` verbatim — it is the guard that stops the
app charging real cards with EPAYTEST credentials. Move it into a module evaluated on server
startup, and keep the "never return a secret in a response body" property that
`test-api.ts` already asserts (`!JSON.stringify(body).includes("8gBm")`).

## 8. Observability

The legacy stack's only observability was `GET /api/health` plus `console.error` in the
error middleware. Port both, then add what the migration specifically needs:

- **`/api/health`** must keep reporting the store ("which file to back up" becomes "which
  database and pool"), and should add pool stats (`totalCount`, `idleCount`, `waitingCount`)
  because pool exhaustion is the new failure mode that did not exist with a single
  in-process SQLite handle.
- **A structured log line per payment transition** (`orderId`, `provider`, `status`,
  `amount`, `source`, `replay`), with the same field names the API returns, so a log query
  and an `--detail` parity report can be read side by side.
- **Alert on**: any `5xx` from a payment route; `waitingCount > 0` sustained; parity
  comparison failure in CI; and a settlement-replay rate of zero (which means the replay
  guard is no longer being exercised — as suspicious as a spike).
- **Never log** the eSewa secret, the Khalti secret key, or a full callback payload
  containing customer email and phone.

## 9. Port checklist (per route, before marking it done)

1. URL identical to the React Router path it replaces.
2. JSON keys and the `completed` / `pending` / `failed` vocabulary unchanged.
3. Amount validated server-side and compared against the **stored** amount, not the
   client's.
4. Replay guard evaluated before any amount comparison.
5. `runtime = "nodejs"` and `dynamic = "force-dynamic"` where money is involved.
6. `server-only` on every module that touches a secret or the database.
7. Covered by an existing suite via `BASE=http://localhost:3000` — or a new assertion if no
   suite covers it.
8. Behaves correctly from a **second device on the LAN**, not just `localhost`.