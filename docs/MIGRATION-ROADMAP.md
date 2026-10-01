# Migrating PURE to Next.js + PostgreSQL — Technical Roadmap

**Status:** proposed · **Owner:** platform · **Applies to:** `pure-retail-shop-main`

This is the execution plan for collapsing a two-process, two-language, two-datastore
application into **one Next.js (App Router) application backed by PostgreSQL, and
nothing else**. It is written against the code in this repository, not against a
generic shopping cart: every constraint below is traceable to a file, and every phase
has an exit gate that can be run.

---

## 1. Where we are, and where we are going

### As-is (verified by reading the code)

| Layer | Today | Where |
| --- | --- | --- |
| Storefront | React 18.3 SPA built by Vite 5, served on `:8080` | `src/`, `vite.config.ts` |
| Routing | React Router 6, 12 routes, client-only | `src/App.tsx` |
| Client state | Zustand 5 + `persist` → `localStorage['ecommerce-store']` | `src/lib/store.ts` |
| Catalogue | Static array of 12 products, no backend at all | `src/lib/mockData.ts` |
| API | Express 5 on `:3001`, run by `tsx`, no build step | `server/index.ts` |
| Ledger | SQLite via `better-sqlite3` 13, WAL, schema v1 | `server/orderStore.ts`, `data/orders.db` |
| Gateways | eSewa (HMAC-SHA256, hand-rolled) + Khalti (secret key, `khalti-checkout-web`) + a local simulator | `server/esewa.ts`, `server/khalti.ts` |
| Tests | 4 suites + 1 sandbox suite, plain `tsx` scripts emitting `PASS`/`FAIL` | `server/test-*.ts` |
| Dead weight | 49 vendored shadcn/ui primitives (17 used); `recharts`, `cmdk`, `embla-carousel-react`, `react-day-picker`, `input-otp`, `vaul`, `react-resizable-panels`, `next-themes`, `react-hook-form`, `zod`, `date-fns`, `@hookform/resolvers` imported by nothing; TanStack Query mounted but never queried | `package.json`, `src/App.tsx` |

### To-be

One deployable: a Next.js App Router application whose Server Components read from
PostgreSQL, whose mutations run through Server Actions or Route Handlers, and whose
only stateful dependency outside itself is a Postgres connection string. A single
origin means the gateway return-URL derivation, the CORS allow-list, and the Vite dev
proxy stop being problems instead of being ported.

### Migration invariants (do not break these — this is the payment contract)

These are not style preferences. Each is asserted by an existing test, and each one
guards a bug the current code has already hit.

1. **The server decides the amount.** `parseAmount` validates and rounds; the stored
   amount is compared against the gateway's with a 0.01 tolerance. The client is never
   trusted. (`server/index.ts`, `server/test-api.ts`)
2. **The signature is verified server-side and the secret never ships.** `test-api.ts`
   asserts `!JSON.stringify(body).includes("8gBm")`.
3. **A completed order is final.** The replay guard answers *before* any amount
   comparison, so a forged payload cannot rewrite a settled row — that is exactly why
   `test:store` case 5 exists.
4. **`gateway_ref` is not unique.** eSewa's `transaction_uuid` has one-second
   resolution, so two checkouts can share a reference; `findByGatewayRef` returns every
   match ordered `created_at ASC, order_id ASC` and the *last* one wins. A unique index
   on this column would break payments. (`server/orderStore.ts`)
5. **Return URLs follow the host the shopper used.** `publicOrigin()` prefers
   `PUBLIC_APP_URL`, then `x-forwarded-host`, then `Host`/`Origin` — which is why the
   Vite proxy deliberately leaves `changeOrigin` off. (`server/index.ts`,
   `vite.config.ts`)
6. **The ledger is a 2-hour window, not a history.** `sweep()` runs on every read and
   write and deletes rows older than `TTL_MS`. This one fact reshapes the entire data
   strategy — see §2 of
   [`docs/migration/02-data-migration-spec.md`](./migration/02-data-migration-spec.md).
7. **`/api/*` is a contract, not an implementation detail.** Four test suites speak JSON
   to those paths. Anything an external caller depends on stays a Route Handler.

---

## 2. Phase overview

| Phase | Name | Ships | Exit gate (green before proceeding) |
| --- | --- | --- | --- |
| 0 | Discovery & audit | This roadmap, the inventory, a frozen dependency baseline | Every route, endpoint, table and import mapped; no unknowns |
| 1 | Decouple & quarantine | Legacy tree frozen behind an ADR; dead code deleted; suites repointed via `BASE` | `npm run test:all` green with zero application change |
| 2 | Target foundation | Next.js skeleton, PostgreSQL schema, migration tooling, parity harness | `migration:compare` passes; `test:api` green against the Next.js server |
| 3 | Incremental migration | Storefront pages, then payment endpoints, cut over route by route behind a proxy | Every route served by Next.js; both stacks run concurrently on one ledger |
| 4 | Production cutover | Freeze → export → import → verify → flip → smoke | Parity proven, freeze < 5 min, rollback rehearsed and timed |
| 5 | Decommission | `express`, `cors`, `vite`, `better-sqlite3`, and the UI dead weight removed | Those packages gone from `package.json`; one deployable |

Phases 0–1 are cheap and reversible. Phase 3 is the long pole. Phase 4 is the only
window with user-visible risk, so it is deliberately the shortest.

---

## 3. Phase 0 — Discovery & audit

**Goal:** replace "roughly this" with an exact, machine-checkable inventory.

Deliverable: [`docs/migration/01-legacy-inventory.md`](./migration/01-legacy-inventory.md).

The four audits that actually find surprises:

1. **Route audit.** Enumerate the `<Route path>` values in `src/App.tsx` and the
   endpoints in `server/index.ts`. Every row must end as *ported*, *replaced by a
   Server Action*, *deleted*, or *kept as a Route Handler*. Nothing may be "TBD" at the
   exit gate.
2. **Import audit.** For each dependency in `package.json`, find its import site. The
   README already concedes a dozen packages are imported nowhere; this converts the
   claim into a deletion list. **This is where the migration gets shorter.**
3. **Contract audit.** Enumerate every JSON field the client reads (for payments,
   `src/lib/payments/api.ts` is the single client) and every field the test suites
   assert on. Those names — and the status vocabulary `completed` / `pending` /
   `failed`, plus `replay` — are the API contract.
4. **Data audit.** Measure the live ledger: row count, provider split, completion rate,
   amount range, reference collisions. Measured on the current `data/orders.db`:
   **106 rows · 61 eSewa / 45 Khalti · 35 completed · NPR 78,212.50 ordered ·
   NPR 23,752.50 settled.**

Exit gate: the inventory has no unanswered rows and every package is marked `keep`,
`upgrade`, or `delete`.

> The purpose of Phase 0 is to make Phase 3 *bounded*. A migration scoped as "port the
> app" never ends; one scoped as "port 12 routes, 7 endpoints, 2 tables" does.

---

## 4. Phase 1 — Decouple & quarantine

**Goal:** establish the seams, then shrink the surface. This codebase is unusually
well-prepared for a port, and the audit should confirm it:

| Seam already present | Why it makes the migration cheap |
| --- | --- |
| `server/orderStore.ts` is the only file containing SQL | The whole datastore swap (driver, dialect, schema, mapping) is confined to one module. `.env.example` concedes the same: *"every query already lives in one file"* |
| `src/lib/payments/api.ts` is the only payments client | `API_BASE = '/api'` is one constant; the client never changes when the server does |
| `server/test-helpers.ts` exports `BASE` (default `:3001`) | The suites can already be pointed at another server, so Next.js gets tested by the *existing* assertions |
| Route paths are plain URLs in one array (`src/App.tsx`) | URL parity keeps gateway return URLs, bookmarks and the callback path working untouched |
| Secrets live only in `server/config.ts` + `.env` | Nothing secret is bundled for the browser, so no `NEXT_PUBLIC_` leak can be introduced by accident |

Work items:

1. **Freeze the store's public surface as the porting contract:** `createOrder`,
   `getOrder`, `findByGatewayRef`, `resolveOrderForCallback`, `markCompleted`,
   `countOrders`, `checkpointDatabase`, `describeStore`. The Next.js implementation must
   satisfy the same semantics; a driver swap behind this interface is the *only* change
   the API layer should ever see.
2. **Lift the magic numbers into config.** `TTL_MS = 2h` (`orderStore.ts`) and
   `MAX_ORDER_AMOUNT` (`money.ts`) are currently literals. They must be configurable
   before cutover, because retention policy is the one thing this migration is
   explicitly allowed to change (§7.4 below).
3. **Record the target-stack decision** as an ADR — ORM, Router, pooling model — so
   Phase 3 has a written answer instead of a re-litigated one. Draft content:
   [`docs/migration/04-nextjs-postgres-architecture.md`](./migration/04-nextjs-postgres-architecture.md).
4. **Delete dead weight now, not later.** Every unimported package removed in Phase 1
   is a package that cannot cause a breaking-change incident in Phase 3. Remove the
   unused `src/components/ui/*` primitives along with `recharts`, `cmdk`,
   `embla-carousel-react`, `react-day-picker`, `input-otp`, `vaul`,
   `react-resizable-panels`, `next-themes`, `react-hook-form`, `zod`, `date-fns` and
   `@hookform/resolvers` — or actually use TanStack Query, which today is a
   `QueryClientProvider` with nothing to provide.
5. **Split the remaining tangles.** `server/index.ts` mixes validation (`parseAmount`,
   `parseOrderId`), origin derivation (`publicOrigin`) and handler logic. Separate them
   into `validation` / `origin` / `handlers` modules so the handlers lift into Route
   Handlers almost verbatim.

Exit gate: `npm run test:all` is green **before and after** these changes, proving the
refactor was behaviour-preserving. Any change in test results is a defect introduced by
the refactor, not a discovery.

---

## 5. Phase 2 — Target foundation

**Goal:** a Next.js app and a PostgreSQL database that are *proven correct* before any
user-facing page moves.

### 5.1 Repository shape — migrate in place

Add the Next.js app **at the repository root** (an `app/` directory beside `src/` and
`server/`), not in an `apps/web` workspace.

- The suites, `.env`, `tsconfig` path aliases and the parity tooling all assume one root;
  a second `package.json` buys nothing here and doubles the environment problem.
- `vite` and `next` coexist in `devDependencies` without conflict during Phase 3.
- Phase 5 then deletes `index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts` and
  `dist/`, leaving the Next.js app as the only entry point.
- Archive the legacy tree as a tag (`legacy/pre-nextjs`) rather than a folder, so nobody
  imports from it by accident later.

### 5.2 Foundation work items

1. **PostgreSQL schema and migrations.** The DDL, type mapping and integrity constraints
   are specified in [`docs/migration/02-data-migration-spec.md`](./migration/02-data-migration-spec.md).
   Non-negotiable: amounts are `numeric(12,2)` (never `real`/`double`), timestamps are
   `timestamptz`, `provider` is an enum, and **`gateway_ref` stays non-unique**.
2. **Migration tooling and the parity harness** — implemented and validated in this
   repository:

   ```bash
   # 1. Snapshot the legacy ledger (read-only by default; never mutates the source)
   npm run migration:export -- --out migration-out --label legacy

   # 2. After importing into PostgreSQL, dump the target table and snapshot it identically
   #    (NDJSON of the orders table — the tool carries no database driver of its own)
   npm run migration:export -- --from-json migration-out/pg.ndjson --label pg

   # 3. Prove both ledgers are identical. Exit code 1 means they are not.
   npm run migration:compare -- migration-out/legacy.manifest.json migration-out/pg.manifest.json --detail
   ```

   Verified against the live ledger:

   ```
     legacy   data/orders.db            106 rows   def6fa04f68421e4…
     target   migration-out/pg.ndjson   106 rows   def6fa04f68421e4…

     PASS  row count survived the cutover (106 → 106)
     PASS  aggregate checksum is identical
     PASS  every order id survived (106 of 106)
     PASS  every row present in both ledgers is byte-identical (106 of 106)
   ```

   Failure modes are deliberately loud. A one-paisa amount change yields
   `FAIL every row present in both ledgers is byte-identical (105 of 106)` and
   `--detail` names the field (`amount: "100.00" → "999999.99"`). A timestamp stored in
   seconds aborts the export with *"Timestamp 1790777493 is too small to be epoch
   milliseconds (is it seconds?)"*.
3. **Repoint the existing suites at Next.js.** `BASE=http://localhost:3000 npm run test:api`
   must pass unchanged. This is the cheapest regression net in the project: four suites
   of payment semantics, written against the *legacy* implementation, guarding the *new*
   one.
4. **One connection pool, created in one place.** A module-level `pg.Pool` singleton
   guarded by `globalThis`, because Next.js dev HMR re-evaluates modules and would
   otherwise leak pools until Postgres refuses connections — a failure that appears only
   in development, which is exactly why it must be designed in rather than discovered.

Exit gate: `migration:compare` passes on a seeded ledger, the schema migration is
reversible (tested `down` path), and `test:api` is green against Next.js.

---

## 6. Phase 3 — Incremental implementation

### 6.1 The decision that removes an entire risk class: proxy, then swap — never dual-write

During Phase 3 there is exactly **one ledger and one writer** at all times. Next.js
becomes the front door on `:3000` immediately, and every `/api/*` path that has not been
ported yet is proxied to the legacy Express process:

```ts
// next.config.ts — present during Phase 3 only; deleted in Phase 5
const LEGACY_API = process.env.LEGACY_API_ORIGIN ?? "http://localhost:3001";

export default {
  async rewrites() {
    return [
      // One entry per endpoint still owned by Express; delete each as it is ported.
      { source: "/api/payments/khalti/:path*", destination: `${LEGACY_API}/api/payments/khalti/:path*` },
      { source: "/api/payments/esewa/:path*", destination: `${LEGACY_API}/api/payments/esewa/:path*` },
    ];
  },
};
```

Dual-writing SQLite and PostgreSQL in parallel was considered and rejected. Order
references are non-unique by design (invariant 4), rows expire on a two-hour sweep
(invariant 6), and any reconciliation between two writers would have to reimplement both
behaviours correctly — strictly more work and more risk than not having two writers at
all. See risk **R-07**.

> **Watch this while proxying:** Next.js rewrites forward the request, and invariant 5
> depends on the original `Host` surviving so the gateway return URL points at the address
> the shopper actually used. Verify from a second device on the LAN *before* trusting it —
> this is the same failure the Vite config documents with `changeOrigin`.

### 6.2 Port order — cheapest and most reversible first

| # | Slice | Moves from | To | Why this position |
| --- | --- | --- | --- | --- |
| 1 | Catalogue + Home / Shop / ProductDetail | `src/lib/mockData.ts`, client components | `products` table, Server Components | Touches no money, is fully cacheable, and rolls back by reverting one page |
| 2 | Cart / Checkout shell | `src/pages/Cart.tsx`, `Checkout.tsx` | Client Components under `(storefront)/` | Pure UI; `localStorage['ecommerce-store']` key must stay identical so carts survive the switch |
| 3 | `POST /api/payments/{esewa,khalti}/initiate` | `server/index.ts` | Route Handlers | First money path; keep the JSON contract byte-identical |
| 4 | `POST /api/payments/{esewa,khalti}/verify`, `POST /api/payments/esewa/status` | `server/index.ts` | Route Handlers | The signature/replay logic must be lifted, not rewritten |
| 5 | `/api/health`, `/api/orders/[orderId]`, `/api/payments/config` | `server/index.ts` | Route Handlers | Introspection; the suites and `test:store` read these |
| 6 | Order store swap | `server/orderStore.ts` (better-sqlite3) | `numeric`/`timestamptz` queries against Postgres | Last, behind the frozen interface, once everything above is green |

Two deletions to fold into this phase rather than Phase 5:

- The Express static/SPA-serving block (`SERVE_CLIENT`, `express.static`, and the
  `app.get("*")` catch-all) is superseded by Next.js routing. Do not port it.
- The `/pay/:provider` simulator route and `MockGateway.tsx` are development-only. Keep
  them behind `PAYMENTS_MODE !== "live"`, or drop them if the simulator in
  `src/lib/payments/simulated-gateway.ts` is enough.

### 6.3 Frontend port mechanics

React Router → App Router is mechanical *if* URL parity is treated as a requirement:

| React Router | App Router |
| --- | --- |
| `<Route element={<Layout />}>` wrapper | `app/(storefront)/layout.tsx` |
| `/`, `/shop`, `/cart`, `/checkout`, `/confirmation` | `page.tsx` per folder |
| `/product/:id` | `app/product/[id]/page.tsx` (`params.id`) |
| `/pay/:provider` | `app/pay/[provider]/page.tsx` (`params.provider`) |
| `/payment/callback` | Route Handler, **not** a page or Server Action (see R-04) |
| `/about`, `/contact`, `/account`, `/wishlist` inline placeholders | Real pages or deleted — they are three-line headings today |

Also: static image imports (`src/assets/products/*.jpg` imported as modules) must become
`next/image` with files in `public/`, or Server Components will fail to resolve them.

Exit gate: every route and endpoint is served by Next.js with the rewrites list empty,
and `npm run test:all` plus `migration:compare` are green.

---

## 7. Phase 4 — Production cutover

### 7.1 The cutover is a drain-and-verify, not a backfill

Because the legacy ledger deletes anything older than two hours on every read and write,
**there is no history to migrate.** What exists at cutover time is at most a two-hour
buffer of pending and completed orders whose payment links expire on the same schedule.
That is a small, bounded, cold dataset — and it means the cutover is minutes, not hours.

```
T+0:00  Enable maintenance mode. Next.js returns 503 for /api/payments/** and the
        checkout route. The catalogue can stay up: browsing cannot create an order.
T+0:30  Stop the Express API. There is now no writer.
T+1:00  npm run migration:export -- --out migration-out --label legacy --freeze
        (--freeze checkpoints the WAL with wal_checkpoint(TRUNCATE), so the snapshot is
        self-contained and the file is safe to archive)
T+1:30  Import into PostgreSQL (COPY from the NDJSON), inside one transaction.
T+2:30  Dump the target table, snapshot it, and run migration:compare --detail.
        A non-zero exit aborts the cutover. Nothing is deployed on a red comparison.
T+3:00  Deploy Next.js with DATABASE_URL pointing at PostgreSQL; remove the rewrites.
T+3:30  Smoke: /api/health, one eSewa and one Khalti initiate→verify in PAYMENTS_MODE=mock,
        GET /api/orders/:orderId, and one real LAN device hitting the callback URL.
T+4:30  Leave maintenance mode. Watch the ledger and gateway error rates for one hour.
```

Target: **under five minutes of payment downtime**, which is the entire blast radius —
the storefront stays readable throughout.

### 7.2 Rollback, and why it is free

The export reads the SQLite file **read-only** unless `--freeze` is passed, and `--freeze`
only truncates the WAL — it never drops or rewrites a row. So the legacy database is
still intact and still correct after a failed cutover:

1. Re-point the rewrites at Express (`LEGACY_API_ORIGIN`), or redeploy the previous
   release.
2. Restart the API against the untouched `data/orders.db`.
3. Verify with `npm run test:store`, which spawns its own API against a throwaway
   database and asserts durability, non-duplication, replay and forged-payload
   behaviour.

Roll back if any of these is observed: parity failure; a `5xx` from any payment endpoint
after the flip; duplicate settlements; or the callback URL resolving to `localhost` from
an external device. Rehearse the rollback **twice before** the real cutover and record the
measured time — an unrehearsed rollback is not a rollback.

### 7.3 Freeze prerequisites (all must be true before T+0:00)

- `migration:compare` has passed on staging twice, on two different snapshots.
- The schema migration has been applied to a production-sized copy and the `down` path
  tested.
- The maintenance-mode page exists and is reachable.
- A `pg_dump` of the target taken *after* the import, kept as the pre-flip restore point.
- Two named people: one executing, one verifying the parity output.

### 7.4 The one policy change worth making deliberately

`numeric(12,2)` plus `timestamptz` means PostgreSQL can retain orders indefinitely, which
SQLite's single-file, sweep-on-read design did not make cheap. Two options, and one must
be chosen explicitly:

- **Keep the two-hour behaviour** (lowest behavioural delta): index `created_at`, compute
  the window as `created_at + interval '2 hours'` in the retention query, and run a
  scheduled `DELETE` — which also removes the write-on-every-read behaviour that the legacy
  `sweep()` imposed on the hot path. (A `GENERATED … STORED` column would be tidier, but
  `timestamptz + interval` is `STABLE` rather than `IMMUTABLE`, so PostgreSQL refuses it —
  verified on 16.14. See the correction note in the data spec.)
- **Extend retention** (e.g. 7–30 days, or keep completed orders indefinitely for
  reconciliation): better for support and chargebacks, but it changes how long customer
  names and email addresses are retained, so it is a privacy decision as much as a
  technical one. Whichever way it goes, it must be written down.

---

## 8. Phase 5 — Decommission & consolidation

The migration is not finished when the new app works; it is finished when the old stack
cannot run. Deletion checklist:

| Remove | Evidence it is safe |
| --- | --- |
| `express`, `cors`, `@types/express`, `@types/cors` | No import of `express` outside the archived tree |
| `better-sqlite3` | No import outside `tools/migration` (which reads the archive only) |
| `vite`, `@vitejs/plugin-react-swc`, `vite.config.ts`, `index.html`, `src/main.tsx`, `dist/` | `next build` produces the only artefact |
| `react-router-dom`, `react-router` | No `<Route>` outside the archive |
| `tsx`, `npm run dev:api`, `dev:sandbox`, `firewall:*` scripts | Next.js serves the API on the same origin; the Vite proxy and its firewall rule are obsolete |
| `SERVE_CLIENT`, `PUBLIC_APP_URL` fallbacks that existed only to work around the two-process split | One origin means one way to know the host — but keep `PUBLIC_APP_URL` for proxy-terminated deployments |

Consolidation wins to bank at the same time:

- **One `package.json`, one lockfile, one build, one port.** The two `tsconfig`s collapse
  into the Next.js one plus the tooling one.
- **CI gates:** `tsc --noEmit`, `eslint`, `test:all`, and `migration:compare` against a
  staging snapshot, on every pull request.
- **A real backup story.** SQLite's selling point was that it is one file, "backed up as a
  unit". PostgreSQL needs a documented equivalent: nightly `pg_dump` plus continuous
  WAL archiving / point-in-time recovery. Losing the ledger to an untested backup is the
  one failure this migration introduces that the old stack did not have.
- **Re-check the invariants.** Re-run `npm run test:all` and `migration:compare` on the
  final commit, then delete the ADR's "during migration" caveats.

Final gate: `npm ls` shows none of the removed packages, and a fresh clone installs,
builds, migrates and passes every suite with no legacy process running.

---

## 9. Where each requirement is answered

| Requirement | Section | Detail document |
| --- | --- | --- |
| Phased migration strategy | §2, §3–§8 | this file |
| Tech-stack consolidation & deprecation | §3.2, §4.4, §8 | [`01-legacy-inventory.md`](./migration/01-legacy-inventory.md), [`03-stack-consolidation.md`](./migration/03-stack-consolidation.md) |
| Data migration & integrity, downtime | §7 | [`02-data-migration-spec.md`](./migration/02-data-migration-spec.md) |
| Next.js ↔ PostgreSQL integration, ORM, API layer | §5, §6 | [`04-nextjs-postgres-architecture.md`](./migration/04-nextjs-postgres-architecture.md) |
| Risk management & QA | §7.2, §7.3 | [`05-risk-register-and-qa.md`](./migration/05-risk-register-and-qa.md) |

### Tooling shipped with this roadmap

| Command | What it proves |
| --- | --- |
| `npm run migration:export -- --out migration-out --label legacy` | Snapshots the SQLite ledger read-only, canonicalises it, and writes `<label>.ndjson` + `<label>.manifest.json` (row count, provider split, completion count, ordered/settled totals, sha256 checksum) |
| `npm run migration:export -- --from-json <dump> --label pg` | Canonicalises a PostgreSQL export through the *same* normaliser, so both sides are hashable |
| `npm run migration:compare -- <legacy> <target> [--detail]` | Ten assertions of ledger parity; exit code 1 on any difference, with `--detail` naming the exact field that changed |

Supporting code: `tools/migration/canonical-order.ts` (money as 2-decimal strings, epoch
ms guarded, snake_case and camelCase aliased), `tools/migration/export-orders.ts`,
`tools/migration/compare-manifests.ts`. Nothing here is imported by the application, so
the harness can be deleted in Phase 5 without touching runtime code.

### Assumptions and things this roadmap does not decide

- **No authentication exists today.** The `user`/`setUser` fields in `src/lib/store.ts`
  are never called. Moving the cart server-side is therefore *not* part of this migration;
  the Zustand `localStorage` key must simply survive unchanged.
- **The card / PayPal / Stripe options are cosmetic.** They are a two-second `setTimeout`
  that writes no order row (`README.md` says so plainly). Delete them, or implement them —
  but do not treat them as a migration dependency.
- **The catalogue is a migration, not an integration.** Twelve products in
  `src/lib/mockData.ts` become rows. With 12 rows, PostgreSQL is not solving a scale
  problem; it is solving a *consistency* problem, because the price shown in the cart and
  the amount the server charges currently come from two different places.
- **Exact Next.js/React versions are not pinned here** because the choice depends on the
  deployment target; the architecture document states the constraints that matter
  (`nodejs` runtime for payment routes, App Router, RSC-first).
- **Timeline is expressed in phases, not weeks**, because the exit gates are what
  determine readiness. Phase 3 is the only open-ended phase in practice.
