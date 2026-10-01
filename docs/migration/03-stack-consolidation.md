# 03 — Tech-Stack Consolidation & Deprecation Plan

Every technology that is not Next.js or PostgreSQL must be identified, audited and removed
— deliberately, with evidence, and without breaking payments.

---

## 1. The audit method

Four passes, in this order, because each one shrinks the next.

**Pass 1 — reachability, not declarations.** A dependency is only "used" if it is reachable
from an entry point (`src/main.tsx`, `server/index.ts`). Counting `package.json` entries
overstates the surface: this repo declares 56 runtime and 19 dev dependencies, and 26 of
the runtime ones are dead. The precise question is *"is this package reachable from live
code?"* — and for `recharts`, `cmdk`, `vaul`, `input-otp` and others the answer is **no**:
they are imported only by vendored `src/components/ui/*` files that no application code
imports. Full table in [`01-legacy-inventory.md` §5](./01-legacy-inventory.md).

**Pass 2 — entry-point coupling.** Classify how tightly each remaining technology binds to
the entry points. Measured result:

| Module | Imports | Coupling | Port cost |
| --- | --- | --- | --- |
| `server/esewa.ts` | `node:crypto`, `./config`, `./money`, a `type` from `./orderStore` | **None** — no framework, no driver | Lifts verbatim |
| `server/khalti.ts` | `node:crypto`, `./config`, `./money`, a `type` from `./orderStore` | **None** | Lifts verbatim |
| `server/money.ts` | none | **None** | Lifts verbatim |
| `server/config.ts` | `dotenv/config`, `node:path`, `node:url`, `process.env` | `dotenv` only | Lifts; Next.js loads env itself |
| `server/orderStore.ts` | `node:crypto`, `node:fs`, `node:path`, `node:module`, `better-sqlite3` | **The driver** | Rewritten once, behind the frozen interface |
| `server/index.ts` | `express`, `cors`, `node:fs`, `node:path` | **The framework** | Handlers lift; the framework is deleted |

That table is the migration in miniature: **four of six server modules port without a
single edit**, because the gateway logic was never coupled to Express. Only the framework
(`index.ts`) and the driver (`orderStore.ts`) are real work.

**Pass 3 — build-tool coupling.** Find every place the *bundler* leaks into application
code, because those changes fail late. Measured: `import.meta.env` appears exactly **twice**
— `src/lib/payments/api.ts:5` and `src/lib/payments/khalti-widget.ts:45`. The second leak is
static asset imports (`@/assets/products/*.jpg`, resolved by Vite) in `src/lib/mockData.ts`
and the product-rendering pages.

**Pass 4 — dialect coupling.** List what is specific to the outgoing *datastore* rather than
to SQL: `db.pragma()` (WAL, `busy_timeout`, `foreign_keys`), `db.transaction()` as a JS
wrapper, named parameters (`@orderId`), `db.prepare()` reuse, `wal_checkpoint(TRUNCATE)`,
`REAL` money. None survives a driver swap on its own; each has a documented Postgres
equivalent in [`02-data-migration-spec.md`](./02-data-migration-spec.md).

## 2. Conflict matrix: outgoing → incoming

| Concern | Outgoing | Incoming | Conflict to resolve |
| --- | --- | --- | --- |
| Bundler / dev server | Vite 5 (`:8080`, `host: "::"`, `/api` proxy, custom firewall rule) | Next.js compiler (`:3000`) | Two dev servers cannot both own `/api`. Next.js takes the front door in Phase 3; Vite is deleted in Phase 5 |
| Entry point | `index.html` + `src/main.tsx` | `app/layout.tsx` + route segments | Both cannot be the app root; keep Vite's only until its last page is ported |
| Routing | React Router 6 (client-only `BrowserRouter`) | App Router (per-route server rendering) | Not a library swap but a rendering-model change. Do **not** keep `react-router-dom` alongside the App Router |
| Env vars | `import.meta.env.VITE_*` (2 sites) | `process.env.NEXT_PUBLIC_*`, server env | `import.meta.env` is `undefined` under Next.js, so this fails at **runtime**, not build time. Two lines, both in `src/lib/payments/` |
| Static assets | `import img from '@/assets/...'` | `public/` + `next/image` | Server Components cannot resolve bundler-resolved asset imports the same way |
| API framework | Express 5 + `cors` + `express.json` | Route Handlers / Server Actions | The middleware chain has no direct equivalent; each row of [`01-legacy-inventory.md` §2](./01-legacy-inventory.md) is reimplemented or deleted |
| Database | SQLite (`better-sqlite3`), a **file path** in `DATABASE_URL` | PostgreSQL (`pg`), a **connection URL** | The single most dangerous config change in the migration: the variable's *meaning* changes |
| SQL dialect | `REAL` money, epoch-ms ints, `pragma`, `@named` params, sweep-on-read | `numeric(12,2)`, `timestamptz`, partial + generated columns, `$1` params, scheduled retention | None of it is mechanical — see the data spec |
| Payments SDK | `khalti-checkout-web` (dynamic import), hand-rolled eSewa HMAC | unchanged | **Nothing to consolidate.** This is the one integration to leave alone |
| Styling | Tailwind 3.4 + `tailwindcss-animate` | Tailwind (3 or 4) | Keep Tailwind; do **not** couple a major-version upgrade to the framework migration |
| Data fetching | TanStack Query mounted, zero queries | RSC + `fetch`/direct DB | Decide — use it for the catalogue, or delete it. Carrying an unused provider forward is how cruft survives migrations |
| Test runner | `tsx` scripts | same (or `node:test`/Vitest later) | Keep `tsx`; it is orthogonal, and the suites are the safety net. Never rewrite tests *while* migrating code |
| Type checking | root `tsconfig.json` (`noImplicitAny: false`, `strictNullChecks: false`) + `tsconfig.app.json` + `tsconfig.node.json` (`strict: true`) | one Next.js `tsconfig.json` + a tooling one | The app is currently *less* strict than the server. Decide target strictness **before** the port, not during it |
| Package manager | `package-lock.json` **and** `bun.lockb` both present | one lockfile | Removing the unused one is free and removes a second CI path |
| React | 18.3.1 | whatever Next.js requires (React 19 line) | Breaking changes to plan for: refs-as-props, `forwardRef` deprecation, `useFormState` → `useActionState`, stricter hydration mismatch reporting. Nothing in this app uses the affected APIs deeply, but `src/components/ui/*` primitives that remain must be re-vendored from current shadcn/ui output rather than patched |
| Node | 20+ (`README.md` requires it; running 24.21.0 here) | unchanged | Nothing to do — but pin it in CI so a Next.js upgrade does not silently raise the floor |

## 3. Deprecation sequence (per technology)

Every removal follows the same five steps. Skipping step 3 is how a deleted technology
comes back.

1. **Freeze.** Tag the tree (`legacy/pre-nextjs`) so the old implementation stays
   recoverable without staying editable.
2. **Prove unreachable.** Delete the dead importer first, then confirm zero remaining
   references. Reachability, not version numbers, is the gate.
3. **Ban re-introduction** the moment the replacement lands, so muscle memory cannot
   restore the old path:

   ```js
   // eslint.config.js — add to the existing flat config
   {
     rules: {
       "no-restricted-imports": ["error", {
         paths: [
           { name: "react-router-dom", message: "Use the App Router (app/) instead." },
           { name: "express",         message: "Use a Route Handler in app/api/." },
           { name: "cors",            message: "One origin — CORS is not needed." },
           { name: "better-sqlite3",  message: "PostgreSQL only; see docs/migration/02-data-migration-spec.md." },
         ],
       }],
     },
   }
   ```

4. **Remove the dependency** (`npm uninstall` + delete the files) in **one** commit, so the
   diff is auditable and revertible as a unit.
5. **Gate it in CI.** The gate is `npm ls <pkg>` returning nothing, plus the existing
   `tsc --noEmit`, `eslint`, `test:all` and `migration:compare`.

Ordering rule that matters: **delete dead code before porting live code.** Every one of the
29 dead UI files and 26 dead dependencies is a file a codemod, a formatter, a React-19
upgrade, or a reviewer must otherwise traverse. Doing this first makes the actual port
smaller, and it is the only step in the whole migration with zero behavioural risk.

## 4. Deprecating non-conforming database engines

This application has exactly one engine (SQLite). A larger legacy estate usually has
several — a document store, a MySQL or SQL Server database, an in-memory cache used as a
source of truth. The method below is the generalised version, and SQLite plays the role of
the first engine to retire.

**Step 1 — Enumerate engines by connection string, not by documentation.**
`DATABASE_URL` in this repo is *not* a URL, which is exactly the kind of assumption that
breaks a multi-engine inventory. Grep for every driver import
(`pg|mysql|mysql2|sqlite|better-sqlite3|mongo|redis|mssql|oracledb|knex|sequelize|typeorm|prisma|drizzle`),
every `*_URL`/`*_URI` env var, and every `docker-compose` service. Each hit is a row in the
deprecation ledger with an owner and a target date.

**Step 2 — Classify each engine by query surface, not by size.** What matters is how much
of the *dialect* is in use, because that is the translation cost:

| Query surface | Example | PostgreSQL path |
| --- | --- | --- |
| Single-table CRUD with no dialect features | the entire legacy `orders` store | Straight port to parameterised SQL (this is why the orders store costs one module) |
| Dialect-specific types | `REAL` money, epoch-ms `INTEGER`, `DATETIME` | Explicit cast at the boundary, decided once — see the data spec |
| Vendor-only syntax | MySQL `ON DUPLICATE KEY UPDATE`, `GROUP_CONCAT`, backticks, `LIMIT n,m` | Rewrite to `ON CONFLICT … DO UPDATE`, `string_agg`, double quotes, `LIMIT m OFFSET n` — the ORM does **not** do this for you in raw mode |
| Engine semantics, not syntax | the 2-hour sweep-on-read; Redis TTLs; Mongo's schemaless documents | Redesigned deliberately, never transliterated (§6 of the data spec) |
| Cross-document joins | `$lookup`, embedded arrays queried as tables | Model in Postgres as real tables + foreign keys **before** moving data, or the migration has nowhere to put it |

**Step 3 — Order the retirements by dependency, not by preference.** Retire reference data
first (read-mostly, easily re-imported, instantly revertible), transactional data last. In
this app: product catalogue first, order ledger last — the same order Phase 3 uses.

**Step 4 — Prefer one-way bridges over dual writes.** When two engines must both serve
traffic briefly, use a read path that falls back (Postgres → legacy) rather than writing to
both. If a bridge is unavoidable, restrict it to a single direction and time-box its
removal date in the same commit that adds it.

**Step 5 — Retire the engine, then retire the *reason*.** After the last query moves:
remove the driver, the connection string, the backup job, the monitoring alert, the IAM
grant, and the documentation page. An engine nobody queries but everybody still pays for is
the most common way a "completed" migration quietly becomes permanent spend.

For a document store specifically, the trap is skipping a schema step: "it's schemaless" is
a property of the *source*, and PostgreSQL is not. Every JSON field that is queried must
become a real column with a real type and a documented default before data moves — or the
migration becomes a `jsonb` column nobody can index or constrain, and the data problem
simply changes address.

## 5. When each removal happens

| Removal | Phase | Gate before doing it |
| --- | --- | --- |
| 29 dead `src/components/ui/*` files + their 26 dependencies | **1** | `npm run test:all` green before and after; zero references remain |
| `zod`, `@hookform/resolvers`, `date-fns` (referenced by nothing) | **1** | Zero references in `src/` and `server/` |
| `bun.lockb` *or* `package-lock.json` (keep one) | **1** | CI uses the keeper |
| `@tanstack/react-query` — use it or drop it | **1** | Written decision recorded in the ADR |
| `next-themes` — keep only if a `ThemeProvider` is actually mounted | **1** | A theme switch works, or the package goes |
| `dotenv` dependency | **2** | Next.js loads `.env.local`; `config.ts` no longer imports `dotenv/config` |
| `VITE_API_BASE`, `VITE_KHALTI_PUBLIC_KEY` | **3** | The two `import.meta.env` call sites are migrated |
| `CLIENT_ORIGIN` / CORS | **3** | No cross-origin client remains |
| `react-router-dom` | **3** | Last page ported; ESLint ban in place |
| `express`, `cors`, `@types/express`, `@types/cors`, `SERVE_CLIENT` | **3** | Rewrites list empty; every endpoint served by a Route Handler |
| `better-sqlite3` | **4 → 5** | `migration:compare` green; legacy server decommissioned |
| `vite`, `@vitejs/plugin-react-swc`, `vite.config.ts`, `index.html`, `src/main.tsx`, `dist/`, `tsx` dev scripts, the firewall scripts | **5** | `next build` is the only build |
| `public/robots.txt` semantics, Tailwind major upgrade | **after** | Never bundle a styling upgrade into a framework migration |

## 6. The consolidation result

After Phase 5 the stack is: **Next.js (App Router) + PostgreSQL + Tailwind + React +
Zustand + the two gateway integrations and nothing else of substance.** Concretely:

- **Two processes → one.** No dev proxy, no CORS, no port 3001, no `SERVE_CLIENT` static
  server, no firewall rule for `:8080`.
- **Two datastores → one.** No SQLite file to back up "as a unit", no WAL checkpointing, no
  sweep-on-read, and money stored as `numeric(12,2)` instead of `REAL`.
- **56 runtime dependencies → roughly 28**, with the survivors being React, Tailwind's
  helpers, Zustand, the 20 UI primitives actually used, the gateway SDK, and the ORM/driver
  chosen in the architecture doc.
- **Three tsconfigs and two lockfiles → one of each.**
- **The payment logic unchanged.** `esewa.ts`, `khalti.ts` and `money.ts` were never
  coupled to the framework or the driver, so they move as-is — which is the strongest
  possible evidence that the migration did not touch the part that matters.