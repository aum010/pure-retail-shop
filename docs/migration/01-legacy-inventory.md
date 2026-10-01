# 01 — Legacy Inventory (Phase 0 artifact)

Everything below was measured from this repository, not estimated.

## 1. Route map — `src/App.tsx`

All routes are nested in `<Route element={<Layout />}>`; `*` is the not-found route.

| Path | Component | File | Disposition |
| --- | --- | --- | --- |
| `/` | `Home` | `src/pages/Home.tsx` | Port → `app/(storefront)/page.tsx` |
| `/shop` | `Shop` | `src/pages/Shop.tsx` | Port → Server Component; filters become `searchParams` |
| `/product/:id` | `ProductDetail` | `src/pages/ProductDetail.tsx` | Port → `app/product/[id]/page.tsx` |
| `/cart` | `Cart` | `src/pages/Cart.tsx` | Port → Client Component (Zustand) |
| `/checkout` | `Checkout` | `src/pages/Checkout.tsx` | Port → Client Component (largest page, 35.5 KB) |
| `/confirmation` | `Confirmation` | `src/pages/Confirmation.tsx` | Port; reads `lastOrder` from Zustand |
| `/payment/callback` | `PaymentCallback` | `src/pages/PaymentCallback.tsx` | **Route Handler, not a page** — risk R-04 |
| `/pay/:provider` | `MockGateway` | `src/pages/MockGateway.tsx` | Keep only when `PAYMENTS_MODE !== "live"` |
| `/about` | inline placeholder | `src/App.tsx` (one line) | Real page or delete |
| `/contact` | inline placeholder | `src/App.tsx` (one line) | Real page or delete |
| `/account` | inline placeholder | `src/App.tsx` (one line) | Real page or delete |
| `/wishlist` | inline placeholder | `src/App.tsx` (one line) | Real page or delete |
| `*` | `NotFound` | `src/pages/NotFound.tsx` | Port → `app/not-found.tsx` |

Routing library: `react-router-dom` 6.30.1, 13 import sites. No nested routes, no data
loaders, no route-level code splitting — which is why this port is mechanical.

## 2. HTTP endpoint map — `server/index.ts`

| Method | Path | Handler behaviour | Called by | Disposition |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | `{ok, paymentsMode, esewaEnv, khaltiEnv, store:{backend,path,rows}}` | `test-store.ts` | Route Handler |
| POST | `/api/payments/esewa/initiate` | Validates + rounds the amount, builds the signed form, **writes the order** | `Checkout.tsx` via `api.ts` | Route Handler |
| POST | `/api/payments/esewa/verify` | Recovers the order (client `orderId`, else `transaction_uuid` from the payload), replay guard, HMAC verify, amount compare ±0.01 | `Checkout.tsx`, `PaymentCallback.tsx`, `test-api`, `test-inpage` | Route Handler |
| POST | `/api/payments/esewa/status` | Server-side status check for orders with no callback; marks completed | `Checkout.tsx` | Route Handler |
| POST | `/api/payments/khalti/initiate` | `POST /epayment/initiate/` with the secret key; **writes the order** | `Checkout.tsx` | Route Handler |
| POST | `/api/payments/khalti/verify` | Replay guard, lookup by `pidx`, `verifyKhalti`, amount compare | `Checkout.tsx`, `PaymentCallback.tsx`, `test-api` | Route Handler |
| GET | `/api/payments/config` | Which mode each provider is really in (never secret values) | `Checkout.tsx` | Route Handler |
| GET | `/api/orders/:orderId` | `{orderId, provider, amount, status, transactionId, createdAt}` | `test-store.ts` | Route Handler |
| — | error middleware | `{ok:false, message}` with `status ?? 500` | all | Reuse as a shared error helper |
| GET | `*` (static) | Serves `dist/` when `SERVE_CLIENT=true` | — | **Delete** (Next.js serves the app) |

Cross-cutting middleware — reproduce it or deliberately drop it:

| Express middleware | Purpose | In Next.js |
| --- | --- | --- |
| `cors({ origin: config.clientOrigin, credentials: true })` | Lets `:8080` call `:3001` | **Delete** — one origin removes the need |
| `express.json({ limit: "64kb" })` | Body cap | `await request.json()`; enforce the cap explicitly if it matters |
| `express.urlencoded({ limit: "64kb" })` | Form posts | `request.formData()` |
| `asyncRoute()` wrapper | Turns rejections into `next(error)` | Not needed; Route Handlers may `throw` |
| `publicOrigin(req)` | Return-URL host derivation (invariant 5) | Reimplement from `headers()`; **must be tested from another device** |

**JSON contract vocabulary that must not drift:** `ok: boolean`; `status` ∈ `completed` /
`pending` / `failed`; plus `replay`, `signatureValid`, `gatewayStatus`, `message`,
`orderId`, `amount`, `transactionId`, `transactionCode`, `pidx`, `transactionUuid`,
`redirectUrl`, and eSewa's `action` / `method` / `fields` and Khalti's `amountPaisa`. The
client-side types are `InitiateResponse`, `VerifyResponse` and `PaymentMode` in
`src/lib/payments/api.ts` — that file is the contract of record.

## 3. Datastore map — `server/orderStore.ts`

File: `data/orders.db` (from `DATABASE_URL`, default `data/orders.db`; the directory is
created on boot). Pragma setup: `journal_mode = WAL`, `busy_timeout = 5000`,
`foreign_keys = ON`. Declared schema version `1` (`DATABASE_SCHEMA_VERSION`), mirrored
into `schema_meta`.

**`schema_meta`** — `key TEXT PRIMARY KEY`, `value TEXT NOT NULL`. One row:
`('version', '1')`.

**`orders`**

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `order_id` | TEXT | PRIMARY KEY | Client-supplied, validated by `parseOrderId` against `^[A-Za-z0-9_-]{3,64}$` |
| `provider` | TEXT | NOT NULL, `CHECK IN ('esewa','khalti')` | Becomes a PG enum |
| `amount` | REAL | NOT NULL, `CHECK (amount > 0)` | Becomes `numeric(12,2)` — a float type for money is the defect this migration fixes |
| `description` | TEXT | NOT NULL DEFAULT '' | Truncated to 100 chars at the handler |
| `customer_name` | TEXT | NOT NULL DEFAULT '' | Truncated to 100 |
| `customer_email` | TEXT | NOT NULL DEFAULT '' | Truncated to 200 |
| `customer_phone` | TEXT | NULL | Truncated to 40 |
| `gateway_ref` | TEXT | NOT NULL DEFAULT '' | eSewa `transaction_uuid` or Khalti `pidx`; **not unique** |
| `created_at` | INTEGER | nullable | Epoch **milliseconds** |
| `completed_at` | INTEGER | NULL | Epoch ms; also the replay guard |
| `result_status` | TEXT | NULL | Gateway status at completion |
| `result_transaction_id` | TEXT | NULL | |
| `result_transaction_code` | TEXT | NULL | |
| `result_amount` | REAL | NULL | The settled amount |

Indexes: `idx_orders_gateway_ref (gateway_ref)`, `idx_orders_created_at (created_at)`.
No foreign keys are declared — there is only one table.

Store API (the frozen porting contract): `createOrder`, `getOrder`, `findByGatewayRef`,
`resolveOrderForCallback`, `markCompleted`, `countOrders`, `clearAllOrdersForTests`,
`checkpointDatabase`, `describeStore`, plus `databasePath` and `DATABASE_SCHEMA_VERSION`.

Behaviour a rewrite must reproduce exactly:

- **`upsertOrder`** is a transaction: first `UPDATE` where `completed_at IS NULL`, then
  insert if no row existed. Re-initiating refreshes a pending order and **can never
  reopen a completed one**.
- **`sweep()`** runs at the top of *every* exported function and executes
  `DELETE FROM orders WHERE created_at < now - 2h`. Reading the ledger writes to it.
- **`findByGatewayRef`** returns *all* matches ordered `created_at ASC, order_id ASC`, and
  `resolveOrderForCallback` takes the **last** one when the client supplies no `orderId`
  — which is the real eSewa callback. eSewa's uuid has one-second resolution, so
  collisions are expected rather than exceptional.
- **Replay-guard ordering:** `completedAt` is checked *before* the amount comparison, so a
  forged amount against a settled order returns the stored result instead of rewriting it.

## 4. Measured state of the live ledger

```
rows 106 · completed 35 · esewa 61 · khalti 45
ordered NPR 78,212.50 · settled NPR 23,752.50
schema v1 · WAL present (data/orders.db, -wal, -shm)
```

Re-derive with:

```bash
npm run migration:export -- --out migration-out --label legacy
```

Note the completion rate: **35 of 106**. The other 71 are pending or failed attempts that
were never settled, and they must still migrate — their callbacks can arrive right up to
the two-hour expiry, which is precisely what the parity harness protects.

## 5. Dependency ledger — 56 runtime deps, 27 of them Radix

Measured by counting references from `src/**` (and, for server packages, `server/**`).

### 5.1 Removable without touching a single line of application code (26 packages)

`src/components/ui/` holds **49 vendored files**; application code imports **20** distinct
`@/components/ui/*` specifiers (alert, badge, button, card, checkbox, dialog, input,
label, radio-group, select, separator, sheet, skeleton, slider, sonner, tabs, toast,
toaster, toggle, tooltip). The other **29** — 28 primitives plus a stale duplicate
`ui/use-toast.ts` that merely re-exports from `@/hooks/use-toast` — are imported by
nothing.

Each dependency below is referenced by exactly one of those dead files, or by nothing at
all. Deleting the dead primitives deletes the dependencies:

| Package | Referenced from | Delete with |
| --- | --- | --- |
| `recharts` | `ui/chart.tsx` | `ui/chart.tsx` |
| `cmdk` | `ui/command.tsx` | `ui/command.tsx` |
| `embla-carousel-react` | `ui/carousel.tsx` | `ui/carousel.tsx` |
| `react-day-picker` | `ui/calendar.tsx` | `ui/calendar.tsx` |
| `input-otp` | `ui/input-otp.tsx` | `ui/input-otp.tsx` |
| `vaul` | `ui/drawer.tsx` | `ui/drawer.tsx` |
| `react-resizable-panels` | `ui/resizable.tsx` | `ui/resizable.tsx` |
| `react-hook-form` | `ui/form.tsx` | `ui/form.tsx` |
| `zod`, `@hookform/resolvers`, `date-fns` | nothing in `src/` or `server/` | — |
| `@radix-ui/react-` `accordion`, `alert-dialog`, `aspect-ratio`, `avatar`, `collapsible`, `context-menu`, `dropdown-menu`, `hover-card`, `menubar`, `navigation-menu`, `popover`, `progress`, `scroll-area`, `switch`, `toggle-group` | only their own unused primitive | the 15 matching primitives |

That is **26 of 56 runtime dependencies** removed by deleting dead files — no refactoring,
no behaviour change, and 29 fewer files for any codemod to traverse during the port.

### 5.2 Keep, and why

| Package | Evidence | Verdict |
| --- | --- | --- |
| `react`, `react-dom` (18.3.1) | 648 / 1 references | Keep; align with the React version Next.js requires |
| `lucide-react` | 31 references | Keep |
| `class-variance-authority`, `clsx`, `tailwind-merge` | 10 / 2 / 1 | Keep — `cn()` in `src/lib/utils.ts` depends on them |
| `zustand` | 2 | Keep — cart, wishlist, `lastOrder`; `persist` key `ecommerce-store` |
| `canvas-confetti` | 3 (confirmation animation) | Keep or delete; it is decoration |
| `sonner`, `@radix-ui/react-toast` | 5 / 1 | Keep — both notification surfaces are mounted in `App.tsx` |
| `@tanstack/react-query` | 1 (the provider in `App.tsx`; zero queries run) | **Decide deliberately:** use it for the catalogue, or remove it. A provider with no queries is not a data layer |
| `next-themes` | reachable only via `ui/sonner.tsx`, which calls `useTheme()` with **no `ThemeProvider` mounted anywhere** | Keep or remove — the prop is inert today |
| `express`, `cors`, `dotenv`, `better-sqlite3`, `tsx` | server-side only | Deletable in Phase 5 |
| `khalti-checkout-web` | dynamically imported | Survives — the one gateway SDK |
| `tailwindcss-animate` (dev) | `tailwind.config.ts` → `plugins: [require("tailwindcss-animate")]` | Keep while Tailwind 3 stays |

## 6. Configuration and secrets inventory

From `.env.example` and `server/config.ts`:

| Variable | Read by | Notes |
| --- | --- | --- |
| `PAYMENTS_MODE` | `config.ts` (a `--mode=` flag wins) | `mock` / `sandbox` / `live`; `assertLiveSecretsPresent()` refuses to start `live` on sandbox credentials — port that guard verbatim |
| `CLIENT_ORIGIN` | CORS origin, return-URL fallback | Unnecessary once there is one origin |
| `PUBLIC_APP_URL` | `publicOrigin()` | Keep; required for HTTPS behind a proxy |
| `PORT` | Express listen port | Replaced by the Next.js server |
| `SERVE_CLIENT` | Optional static serving of `dist/` | Delete |
| `ESEWA_ENV`, `ESEWA_MERCHANT_ID`, `ESEWA_PRODUCT_CODE`, `ESEWA_SECRET_KEY` | `esewa.ts` | The `EPAYTEST` values in the example file are public test credentials, not the production secret |
| `KHALTI_ENV`, `KHALTI_SECRET_KEY` | `khalti.ts` | Empty means "use the simulator even in sandbox mode" |
| `DATABASE_URL` | `orderStore.ts` | Currently a **file path**, not a URL. PostgreSQL makes it a genuine connection URL — the one variable whose *meaning* changes |
| `VITE_API_BASE` | `src/lib/payments/api.ts` | Becomes `NEXT_PUBLIC_API_BASE`, or disappears when one origin is the only origin |
| `VITE_KHALTI_PUBLIC_KEY` | Khalti in-page widget | Becomes `NEXT_PUBLIC_KHALTI_PUBLIC_KEY`; a public key, safe to expose |

`config.ts` is already well behaved: nothing in it is bundled for the browser, and the
`VITE_` prefix is the only thing preventing a leak. Next.js inverts that mechanism —
private unless prefixed `NEXT_PUBLIC_` — which is a safer default *only* if server modules
are marked `import "server-only"`, so that a mistaken client import fails the build
instead of shipping the secret.

## 7. Test inventory — the regression net to spend on the migration

| Suite | Script | Target | Reusable against Next.js? |
| --- | --- | --- | --- |
| `test-api.ts` | `npm run test:api` | `BASE` (default `:3001`) | **Yes** — `BASE=http://localhost:3000` |
| `test-inpage.ts` | `npm run test:inpage` | `BASE` | **Yes** |
| `test-currency.ts` | `npm run test:currency` | Pure functions in `src/lib/currency.ts` | **Yes**, unchanged |
| `test-store.ts` | `npm run test:store` | Spawns its own API against a throwaway SQLite file | Needs an equivalent that spawns Next.js against a throwaway Postgres schema |
| `test-esewa-sandbox.ts` | `npm run test:sandbox` | Real eSewa sandbox | **Yes**, in `sandbox` mode over the network |

`test-store.ts` is the most valuable suite here: it asserts durability across a restart,
one row per retried order, replay safety, that a completed order cannot be reopened, and
that a forged payload cannot rewrite a settled row. Every one of those is a property a
naive port can silently lose.
