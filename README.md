# PURE

A small apparel storefront — 12 products, cart, three-step checkout, order
confirmation — with the two Nepalese wallets that shoppers there actually use,
**eSewa** and **Khalti**, wired up properly: the amount is decided by the server,
the signature is checked by the server, and every order is written to a
**PostgreSQL** table that survives a restart.

It is one application now: a **Next.js (App Router)** process on port 3000 that
renders the storefront as Server Components, answers the payment API as Route
Handlers, and talks to one database. `npm install`, point `DATABASE_URL` at a
PostgreSQL instance, run `npm run db:migrate && npm run db:seed`, then
`npm run dev` — and you can take a payment end to end: offline against a
simulator, or against eSewa's real sandbox with the public test merchant and no
account of your own.

Everything else is scaffolding you would expect and, in a few cases, scaffolding
this project does not finish: About, Contact, Account, and Wishlist are
placeholders, and the Card / PayPal / Stripe options are cosmetic.
[What is real, and what is simulated](#what-is-real-and-what-is-simulated) lists
every one of them, because a payment integration is only worth trusting if you
know exactly which parts are load-bearing.

The project used to be two processes — a Vite SPA and an Express/SQLite payment
API. It is now a single Next.js app on PostgreSQL, and the ledger was carried
across under a checksum. [Migration status](#migration-status) describes what
remains of the old stack and why.

## Features

**Storefront**

- 12 products across 7 apparel categories (Outerwear, Tops, Knitwear, Bottoms,
  Footwear, Bags, Accessories), filterable by category, tags, and price range,
  with sorting. The catalogue lives in a `products` table and is read live by
  Server Components — the static `mockData.ts` array is gone, and pages are
  rendered per request so an HTML snapshot can never advertise prices the
  server would refuse. The search icon in the header is still decorative.
- Product detail pages with size and colour selection, related products from
  the same query layer
- Cart persisted across reloads with Zustand (`localStorage`)
- Wishlist state that persists and can be toggled from any product card, but has
  no page yet — `/wishlist` renders a placeholder heading
- Three-step checkout: billing → shipping → payment
- Confirmation page showing the real order number, gateway, amount, and the
  transaction id and reference code the gateway returned

**Payments**

- **eSewa** and **Khalti** are the two options that can actually settle money.
  Card, PayPal, and Stripe are selectable radio buttons whose submit handler is a
  2-second `setTimeout` that clears the cart and navigates — template layout, not
  integrations. See [What is real, and what is
  simulated](#what-is-real-and-what-is-simulated).
- Both wallets can be paid **on the checkout page itself** in mock mode — no
  redirect, no popup
- PostgreSQL order ledger — orders, gateway references, and settled amounts
  survive a restart and can be inspected with any SQL client

**Not built**

`/about`, `/contact`, `/account`, and `/wishlist` are single-heading placeholder
pages under `app/`. There is no authentication: the store has a `user` field and
a `setUser` action, and nothing in the app ever calls it.

## Tech stack

**Application**

- **Next.js 15** (App Router) + **React 19** + **TypeScript** — one process, one
  origin, port 3000. The storefront pages are Server Components; the interactive
  pieces (cart, checkout, product cards, the wallet panel) are Client
  Components.
- **Route Handlers** under `app/api/` replace the old Express server. Same JSON
  contract, same security properties, no CORS and no dev proxy — the browser and
  the payment API are the same origin.
- **PostgreSQL** through **drizzle-orm** + `node-postgres`. The authoritative
  schema is `drizzle/0000_init.sql`; `src/lib/db/schema.ts` mirrors it for typed
  queries. Money is `numeric(12,2)` and stays a string until the API boundary —
  it never becomes a float.
- **Tailwind CSS** with the design tokens in `tailwind.config.ts`
- **shadcn/ui** — 20 primitives in `src/components/ui/` (the unused template
  leftovers and their dependencies — `recharts`, `cmdk`, `react-day-picker`,
  `react-hook-form`, `zod`, … — were deleted in the migration)
- **Zustand** for cart / wishlist / last-order state (persisted to
  `localStorage`), **canvas-confetti** for the confirmation animation
- **`khalti-checkout-web`** — the one gateway SDK, imported dynamically so it
  only loads when the Khalti in-page widget is actually used. eSewa stays
  SDK-free: its signature is made with Node's built-in `crypto`.

**Server-side only**

Every module under `src/server/` and `src/lib/db/` starts with
`import "server-only"`, so a mistaken client import fails the build rather than
leaking a secret — Next.js inlines only `NEXT_PUBLIC_*` variables, and nothing
secret carries that prefix.

**Legacy, kept on purpose**

`server/` (Express + `better-sqlite3`) no longer serves the app. It is the
reference implementation the payment test suites still drive, and
`tools/migration/` reads the old SQLite ledger to prove the data cutover. The
`express`, `cors`, and `better-sqlite3` dependencies exist for those two jobs.

## What is real, and what is simulated

The one question that matters here is which parts of a checkout can actually move
money, so it is answered as a table rather than left to be discovered.

| What you click | What happens | Where |
| --- | --- | --- |
| eSewa at checkout | Real API call, real signature, real redirect to eSewa in `sandbox`/`live`; settles locally in `mock` | `src/server/esewa.ts`, `app/api/payments/esewa/` |
| Khalti at checkout | Real `POST /epayment/initiate/` with the secret key when configured; falls back to the simulator otherwise | `src/server/khalti.ts`, `app/api/payments/khalti/` |
| Card / PayPal / Stripe | `setTimeout` for 2 seconds, clear the cart, navigate to `/confirmation`. No server call, no order row, no gateway | `app/_pages/Checkout.tsx` |
| "Pay" on the mock wallet panel | Rebuilds the callback the wallet would have sent and posts it to the real `/verify` route, which re-checks the amount and signature | `src/lib/payments/simulated-gateway.ts` |
| `/pay/:provider` | Simulated hosted gateway page, reachable only in mock mode | `app/pay/[provider]/page.tsx` |
| `/about`, `/contact`, `/account`, `/wishlist` | Placeholder headings. No content, no data | `app/…/page.tsx` |

The card path is the one to watch: because it lands on the same confirmation page,
that page falls back to a fabricated order number and a "Card" gateway label when
no verified order was stashed. A card "order" therefore leaves **no trace in the
database** — `GET /api/health` will report it in the row count. Treat it as a
design placeholder, not as a working payment method.

## Getting started

Requires Node.js 20 or newer **and a reachable PostgreSQL instance** — a local
`postgres` server, a container, or a hosted URL. The app refuses to start any
payment route without one: `DATABASE_URL` must be a `postgres://` URL.

```bash
# Install dependencies
npm install

# Configure: Next.js loads .env.local (git-ignored) automatically.
# The minimum that works — create .env.local with:
#   DATABASE_URL=postgres://postgres@127.0.0.1:5433/pure_retail
#   PAYMENTS_MODE=mock

# Create the orders + products tables (re-runnable, every statement guarded)
npm run db:migrate

# Seed the 12-product catalogue from src/lib/catalogue.ts (upserts; safe to re-run)
npm run db:seed

# Start the app — storefront AND payment API on http://localhost:3000
npm run dev
```

> `.env.example` still documents the retired Express/SQLite layout (it predates
> the migration). The live contract is `src/server/config.ts`; the variables
> that matter are `DATABASE_URL`, `PAYMENTS_MODE`, `PUBLIC_APP_URL`, the
> `ESEWA_*`/`KHALTI_*` credentials, `MAINTENANCE_MODE`, and
> `NEXT_PUBLIC_KHALTI_PUBLIC_KEY`.

The built-in sandbox gateway credentials mean no `.env.local` edits are needed
to take a mock or eSewa-sandbox payment — only for live money.

### Taking your first payment, end to end

With the app up in `mock` mode, which is the default:

1. Open <http://localhost:3000>, add anything to the cart, go to `/checkout`.
2. Fill billing, then shipping, and reach **step 3, Payment**.
3. Pick eSewa or Khalti. A sign-in panel appears **on the page** — nothing
   redirects, because in mock mode there is no remote gateway to redirect to.
4. The test credentials are shown as placeholders. Read them and type them in;
   nothing is pre-filled and nothing is stored.
5. Press **Pay**. The route handler signs the order, the browser rebuilds the
   callback the wallet would have sent, the server verifies it, and only then
   does the cart clear and the confirmation page appear with a real order number
   and transaction id.
6. `GET /api/health` reports the ledger: the order is a row in the `orders`
   table, and it is still there after you restart the server —
   `npm run test:store` proves exactly that.

## Project structure

```text
app/                        Next.js App Router — the whole application
  page.tsx                  /        Server Component: featured products from PG
  shop/ product/[id]/       /        Server Components: catalogue reads from PG
  _pages/                   Presentational pages (Client Components):
    Home  Shop  ProductDetail        Browse, filter, size/colour, wishlist toggle
    Cart                           Line items, quantities, calculateTotals()
    Checkout                       3 steps; the wallet panel lives here
    PaymentCallback                Gateway redirect lands here, forwards to /verify
    Confirmation                   Reads the verified order from the store
    MockGateway                    Simulated hosted page (mock mode only)
  cart/ checkout/ confirmation/ …    Thin route wrappers around _pages/
  pay/[provider]/           Simulated hosted gateway (mock mode only)
  payment/callback/         Where the real gateways redirect back to
  api/                      Payment API — Route Handlers, same origin
    health/                       Liveness + ledger row count (+ TTL sweep)
    orders/[orderId]/             Order status
    payments/config/              Mode/env report, never secret values
    payments/esewa/{initiate,verify,status}/
    payments/khalti/{initiate,verify}/
  layout.tsx  providers.tsx  not-found.tsx

src/
  components/               Header, Footer, ProductCard, WalletPaymentForm,
                            ui/ (20 shadcn primitives)
  lib/
    catalogue.ts            The 12-product catalogue — the seed source for PG
    store.ts                Zustand: cart, wishlist, lastOrder (persisted)
    currency.ts             NPR formatting, 13% VAT, delivery rules
    paymentOrder.ts         sessionStorage stash that survives the gateway redirect
    db/                     client.ts (the one pg pool), schema.ts, products.ts
    payments/               types, api client, per-gateway browser adapters,
                            khalti-widget.ts, simulated-gateway.ts
  server/                   Server-only payment logic (import "server-only")
    api.ts                  parseAmount/parseOrderId, error → JSON plumbing
    config.ts               Env parsing; refuses to start live on sandbox keys
    orders.ts               PostgreSQL ledger: create/get/verify/sweep
    esewa.ts                ePay v2 signing, callback verification, status check
    khalti.ts               Initiate and lookup against Khalti v2
    money.ts                NPR formatting + MAX_ORDER_AMOUNT
    origin.ts               Return-URL derivation (PUBLIC_APP_URL → x-forwarded-host)

drizzle/0000_init.sql       Authoritative PostgreSQL DDL (orders + products)
scripts/                    db-apply.ts (db:migrate), db-seed-products.ts (db:seed),
                            db-import-orders.ts (legacy ledger loader)
tools/migration/            SQLite export + manifest compare — proves the cutover
docs/                       Migration roadmap + the five detail documents
server/                     LEGACY reference: Express + SQLite order store,
                            and the payment test suites (test-*.ts) it drives
data/                       LEGACY SQLite ledger (orders.db) — archived, read
                            only by tools/migration
migration-out/              Ledger snapshots + manifests (git-ignored: contains
                            customer names and email addresses)
public/                     Product and hero photographs (referenced by path)
```

## Database

Orders and the catalogue live in **PostgreSQL**. `DATABASE_URL` must be a
`postgres://` URL — a file path is rejected at boot with an explicit error, so
nobody silently starts the old SQLite server by missetting it.

| Setting | Value |
| --- | --- |
| Schema | `drizzle/0000_init.sql`, applied by `npm run db:migrate` (every statement guarded; safe to re-run) |
| Seed | `npm run db:seed` upserts the 12 products from `src/lib/catalogue.ts` |
| Client | `src/lib/db/client.ts` — one `pg` Pool on `globalThis` (survives dev hot-reload), max 10 (`DB_POOL_MAX`), 5 s statement timeout |
| Money | `numeric(12,2)`; `node-postgres` returns it as a string and it stays a string until an explicit conversion — floats never hold money |
| Retention | Orders older than 2 h are swept — explicitly, on `GET /api/health`, not on every query |

Inspect it with any SQL client:

```sql
SELECT order_id, provider, amount, gateway_ref,
       completed_at IS NOT NULL AS paid
FROM orders ORDER BY created_at DESC LIMIT 10;
```

**How the store is used.** Every `initiate` writes a row recording the exact
amount the server charged; every `completed` verification updates that row.
Callback resolution reads from the same table, so the amount a callback is
checked against always comes from the database and never from the browser.
Completion is final: a conditional `UPDATE` answers a replayed callback once —
including the case where the replayed payload carries a *different* amount,
which the guard rejects before any comparison rewrites the settled row.

**Two deliberate schema choices** from the SQLite original: `gateway_ref` is
**not unique** (eSewa's `transaction_uuid` has one-second resolution; a unique
index would break payments — the callback lookup takes the newest matching
live row), and a `CHECK` constraint mirrors the order-id grammar the API
validates, so a malformed id can never be persisted even by hand.

## Payments: eSewa & Khalti

Two Nepalese wallet gateways are offered as payment methods on the checkout step.
Gateway secrets live **only** in server modules under `src/server/`; the browser
never receives them and never decides whether a payment succeeded. There is one
process and one origin, so there is no CORS allow-list and no dev proxy to keep
in sync — the return-URL derivation (`src/server/origin.ts`) prefers
`PUBLIC_APP_URL`, then `x-forwarded-host`, then `Host`, so browsing from a phone
on your LAN still redirects back to the phone.

### The three modes

| Mode | What it does | Command |
| --- | --- | --- |
| `mock` | Local simulator, no network. Every path is reachable offline. | `npm run dev` |
| `sandbox` | Real gateway test environments. **eSewa works with zero setup.** | `npm run dev:sandbox` |
| `live` | Real money. Refuses to start with sandbox credentials. | — |

**Recommended: mock mode.** Choosing eSewa or Khalti at checkout opens the
wallet's sign-in form **inside the checkout page** — the shopper never leaves the
site, there is no redirect and no popup:

- The test credentials are shown as **placeholders** in the inputs, so you read
  them and type them in. Nothing is pre-filled, and no credential is stored.
- Filling in the form and pressing **Pay** completes the payment in place: the
  cart is cleared and the confirmation page appears, exactly as in a real run.
- **Pending / Failed / Cancel** are one click each, so every outcome a gateway
  can report is reachable without filling the form in.

The whole settlement happens in-place: the server returns the fields it would
have sent to the wallet, the browser rebuilds the callback the wallet would have
returned, and the server verifies it. `server/test-inpage.ts` drives exactly
that sequence against the real endpoints.

**eSewa sandbox** — run `npm run dev:sandbox` (a Windows-friendly wrapper for
`PAYMENTS_MODE=sandbox`). eSewa's test environment works with the public
`EPAYTEST` merchant, so no merchant account is required. You will be redirected
to the real eSewa page at `rc-epay.esewa.com.np` and can log in with the sandbox
credentials below. Log in, approve, and you return to the store's confirmation
page.

**Khalti sandbox** — needs a `live_secret_key` from
[test-admin.khalti.com](https://test-admin.khalti.com) in `.env.local`. Until
that is set, Khalti automatically falls back to the local simulator even in
sandbox mode, so it never fails with an unauthenticated 401.

**Sandbox credentials** (also shown on the checkout panel and the simulated
hosted page):

| Gateway | Identifier | Password | MPIN | OTP |
| --- | --- | --- | --- | --- |
| eSewa | `9711111111` (also `…12` / `…13`) | `Test@123` | `1122` | — |
| Khalti | `9800000000` (`…01`–`…05`) | — | `1111` | `987654` |

### Test suites

```bash
npm run test:api        # 29 checks: initiate/verify/status/validation + full flow
npm run test:inpage     # 23 checks: the in-page checkout, both wallets, 4 outcomes
npm run test:store      #  8 checks: SQL persistence across a real process restart
npm run test:currency   # 13 checks: NPR formatting, VAT, delivery, thresholds
npm run test:sandbox    # real eSewa sandbox: signed initiate, 302 to payment page (server in sandbox mode)
npm run test:all        # everything that does not need the real sandbox
```

The suites drive the payment API over HTTP at `BASE` (default
`http://localhost:3001`, which is the legacy reference server under `server/`;
set `BASE=http://localhost:3000` to drive the Next route handlers instead).
`test:currency` needs no server. `test:store` spawns its own reference-API
process against a throwaway SQLite file, so it disturbs nothing — it proves the
ledger semantics (restart survival, refresh-not-duplicate, replay-once) that
both the SQLite and PostgreSQL stores implement. All four offline suites are
green against the current tree, as are `npm run typecheck` and
`npm run typecheck:api`.

`test:inpage` imports the real client-side callback builder and posts its output
to the live verify endpoint, so the shape the browser produces is the shape
under test. It also covers the forgery cases: a rewritten amount, a payload
presented under another order's id, and another order's `pidx`. `test:sandbox`
posts a genuinely signed request to eSewa and asserts the sandbox answers with
a `302` to its payment page. Test order ids are tagged with a random `runTag`,
because orders persist — without it a second run would collide with the first
run's completed rows.

### Payment flow

1. `Checkout.tsx` POSTs to `/api/payments/{provider}/initiate`.
2. The server **inserts a row recording the exact amount it charged**, then:
   - **eSewa** -- builds and signs the initiate request, returning the gateway
     URL plus the signed fields.
   - **Khalti** -- calls `/epayment/initiate/` with the secret key and returns
     the `pidx` checkout redirect.
3. The shopper pays, and the outcome comes back one of two ways:
   - **In `mock` mode** the browser rebuilds the callback the wallet would have
     sent and posts it straight to step 4. Nothing navigates.
   - **Against a real gateway** the shopper authenticates on the gateway's own
     domain and is redirected to `/payment/callback`.
4. `PaymentCallback` -- or the checkout page directly, in mock mode -- forwards
   the callback to `/api/payments/{provider}/verify`. The server re-checks the
   payment and replies; only a `completed` reply clears the cart and records
   the order.
5. `Confirmation` renders the real order number, gateway, amount, and
   transaction IDs.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/payments/esewa/initiate` | Signs and returns the eSewa request |
| POST | `/api/payments/esewa/verify` | Verifies the eSewa callback (signature check) |
| POST | `/api/payments/esewa/status` | Status check when no callback arrived |
| POST | `/api/payments/khalti/initiate` | Calls Khalti initiate, returns checkout redirect |
| POST | `/api/payments/khalti/verify` | Confirms via Khalti lookup |
| GET | `/api/payments/config` | Reports mode/env, never secret values |
| GET | `/api/orders/:orderId` | Order status |
| GET | `/api/health` | Liveness check, ledger row count, and the TTL sweep |

Every path is a Route Handler under `app/api/`, sharing one plumbing module
(`src/server/api.ts`) that ports the old Express error middleware: a rejected
handler becomes `{ ok: false, message }` with its `status`, never a stack trace.

### Security properties

These are the reasons verification lives on the server, and each is covered by
the test suite:

- **Secrets never reach the client.** Next.js inlines only `NEXT_PUBLIC_*`
  variables; every module that reads a secret is marked `import "server-only"`,
  so a mistaken client import fails the build instead of shipping a key.
- **Amounts are never trusted from the client.** The server stores the amount it
  charged and compares the gateway's figure against it; a mismatch fails even
  when the gateway says `COMPLETE` / `Completed`.
- **Signatures are verified with a constant-time compare.** A `COMPLETE` eSewa
  callback whose signature does not recompute is rejected.
- **Replay is idempotent.** A completed order will not be completed twice — the
  guard is a conditional `UPDATE` in the database, so it holds across processes.
- **Callback references are cross-checked.** A `pidx` that belongs to a
  different order than the supplied `orderId` is refused, so one order's
  callback cannot mark another paid.
- **Only the documented success values count.** `COMPLETE` (eSewa) and
  `Completed` (Khalti). `PENDING` / `Pending` / `AMBIGUOUS` are held for review.
- **A simulated callback cannot be forged into a different payment.** The
  in-page panel replays the fields the server itself signed, so rewriting the
  amount or presenting one order's payload under another order's id is rejected
  — `test:inpage` covers all three cases.

### Paying without leaving the site

**In `mock` mode both wallets pay in place.** The checkout page renders each
wallet's sign-in form itself, with the test credentials as placeholders, and
settles the result through the API without navigating anywhere. Nothing is
pre-filled and no credential is stored — the fields exist so the flow reads like
a real checkout and so the test values are discoverable.

**Against the real gateways the rules are different, and they differ per
gateway:**

**Khalti — in-page is supported.** Khalti publishes an official browser SDK
(`khalti-checkout-web`) that overlays a secure full-screen checkout on your own
page, so the shopper never navigates away. Set `NEXT_PUBLIC_KHALTI_PUBLIC_KEY`
to switch it on:

```bash
# .env.local
NEXT_PUBLIC_KHALTI_PUBLIC_KEY=test_public_key_…
```

The public key is designed to live in client-side code and cannot move money by
itself — the widget's result is still verified server-side with the secret key
before the order is treated as paid. The SDK loads lazily, only when Khalti is
actually selected, so it costs nothing on the initial page load.

**eSewa — not possible in-page.** eSewa has no web SDK and no embeddable widget.
Its only browser flow ("ePay") requires redirecting the shopper to eSewa's own
site, where they enter their MPIN; eSewa's "Intent" product goes further and
hands off to the installed mobile app via a deep link. Neither can be embedded
in a merchant page — that is a limitation of the gateway, not of this
integration. What the app does instead:

- **Desktop:** the standard redirect to eSewa, then back to the confirmation page.
- **Mobile:** an "Open the eSewa app instead" button that deep-links to the
  wallet app (`esewa://`), so the payment happens in the app rather than on a
  web page. If the app is missing, the Play Store listing opens.

The checkout page says which of these applies, so the shopper is never promised
in-page payment that the gateway cannot deliver.

### Gateway specifics

**eSewa** -- ePay **v2**. The request is signed with HMAC-SHA256 (RFC 2104) over
`total_amount=...,transaction_uuid=...,product_code=...`, base64 encoded, then
POSTed to `/api/epay/main/v2/form` with `amount`, `tax_amount`, `total_amount`,
`transaction_uuid`, `product_service_charge`, `product_delivery_charge`,
`product_code`, `success_url`, `failure_url`, `signed_field_names`, `signature`.

Two traps for anyone following older write-ups:

- The legacy path `/api/epay/transaction/process` returns **404**, and the legacy
  `amt`/`pwd` fields are no longer accepted.
- The old test host `uat.esewa.com.np` **no longer resolves**. Use
  `rc-epay.esewa.com.np` for testing and `epay.esewa.com.np` for production.

The callback arrives as `?data=<base64 JSON>` on `success_url`; failures land on
`failure_url` with an `error_code`. Status check is
`GET /api/epay/transaction/status/?product_code=...&total_amount=...&transaction_uuid=...`
and answers `COMPLETE`, `PENDING`, `CANCELED`, `NOT_FOUND`, `AMBIGUOUS`, plus
the refund variants.

Docs: <https://developer.esewa.com.np/pages/Test-credentials>
Sandbox merchant `EPAYTEST`, secret `8gBm/:&EnhH.1/q`, ID `9711111111` (also
`9711111112` / `9711111113`), password `Test@123`, MPIN `1122`. Some older
write-ups list `9806800001` / `Nepal@123`; both work, but the page above is
authoritative.

**Khalti** -- amounts are in **paisa**. Initiate is
`POST /api/v2/epayment/initiate/`; confirmation is
`POST /api/v2/epayment/lookup/` with `{ "pidx": ... }`, and in real mode the
lookup result -- not the callback -- decides the outcome. Docs:
<https://docs.khalti.com/khalti-epayment/>
Sandbox: ID `9800000000`, MPIN `1111`, OTP `987654`.

### Before going live

1. Set `PAYMENTS_MODE=live` with real credentials, `ESEWA_ENV=production`, and
   `KHALTI_ENV=production`. `src/server/config.ts` refuses to answer payment
   routes until all three hold, so sandbox keys cannot process a real payment.
2. Set `PUBLIC_APP_URL` to your HTTPS origin so the gateways redirect back to
   the real site rather than whatever `Host` header arrived.
3. **Back up PostgreSQL.** Orders, gateway references, and settled amounts all
   live in the `orders` table — it is what a late callback is reconciled
   against.
4. Review the VAT rate, delivery charge, and free-delivery threshold in
   `src/lib/currency.ts` — they are set to Nepal's 13% VAT and a flat NPR 150
   delivery fee, free over NPR 5,000.
5. Add authentication/rate limiting on the initiate and verify endpoints.

## Known limitations

- **Orders are swept after 2 hours.** That matches the gateways' payment-link
  window, but it means an order cannot be reconciled after it expires. The
  sweep runs on `GET /api/health` (raising `ORDER_TTL_MS` in
  `src/server/orders.ts`, or setting `MAINTENANCE_MODE` to skip deletes,
  extends the trail).
- **eSewa's `transaction_uuid` has one-second resolution**, so two checkouts
  started in the same second share one. Our own flows are unaffected because the
  callback always names its order id, and the ledger keeps *every* order that
  claimed a reference rather than only the newest. But a genuine eSewa callback
  carries no order id, so if two same-second checkouts were both in flight, the
  server can only match the reference to one of them. The amount cross-check
  refuses a mismatched settlement rather than marking the wrong order paid,
  which is the strongest guarantee available without a disambiguator the gateway
  does not supply.
- **`/verify` trusts the client-supplied status in `mock` mode.** In `sandbox`
  and `live` the Khalti lookup result is authoritative and the callback is only
  a hint — but in mock mode there is no gateway to ask. Passing in mock mode is
  not evidence that the live path works; that needs a real sandbox transaction
  (`npm run test:sandbox`).
- **The in-page wallet form is a simulation.** It is not eSewa's or Khalti's real
  sign-in UI, and it accepts any non-empty input. It exists so the settlement
  path can be driven end to end offline, not to authenticate anyone.
- **The test suites still default to the legacy reference server** (`BASE`
  defaults to `http://localhost:3001`). Porting them to drive the Next process
  directly is the remaining cleanup from the migration; the JSON contract is
  identical, which is why `BASE=http://localhost:3000` works today.

## Migration status

This application used to be two processes: a Vite/React SPA on `:8080` and an
Express payment API on `:3001` backed by a SQLite file. It now runs as **one
Next.js (App Router) process on `:3000` backed by PostgreSQL** — that is the
destination described in [`docs/MIGRATION-ROADMAP.md`](docs/MIGRATION-ROADMAP.md)
and `docs/migration/`, and it is where the application lives.

What remains of the old stack, and why:

- `server/` — the Express + SQLite reference implementation. It is no longer
  wired to any npm dev script; it stays because the payment test suites were
  written against it and it pins the JSON contract the Route Handlers had to
  match.
- `data/orders.db` — the old ledger, archived. Read only by `tools/migration`
  to regenerate proof manifests.
- `.env.example` — still describes the Express-era variables; treat
  `src/server/config.ts` as the contract until it is refreshed.

The data move was made provable rather than hopeful, and it passed:

```bash
# Snapshot the SQLite ledger (read-only by default; --freeze checkpoints the WAL)
npm run migration:export -- --out migration-out --label legacy

# Load it into PostgreSQL (refuses if the target ledger is not empty)
npm run db:import-orders -- --from migration-out/legacy.ndjson

# Canonicalise the live Postgres table through the same normaliser,
npm run migration:export -- --from-json migration-out/pg.ndjson --label postgres

# …and prove both ledgers are identical. Exit code 1 means the cutover must not
# proceed; --detail names the exact field that differs on any changed row.
npm run migration:compare -- migration-out/legacy.manifest.json migration-out/postgres.manifest.json --detail
```

The cutover snapshot: **106 orders, 61 eSewa / 45 Khalti, 35 completed —
imported into PostgreSQL with an identical aggregate checksum and 10/10 parity
checks passing.** Snapshots live in `migration-out/`, which is git-ignored
because an orders dump contains customer names and email addresses.

