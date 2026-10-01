# 05 — Risk Management & Quality Assurance

## 1. How risk is managed here

- **Every risk gets a detection signal.** A risk with no observable signal is a hope, not a
  control. The "Signal" column is what a human or an alert actually watches.
- **Every risk gets a containment action**, not just a mitigation. Mitigation lowers the
  chance; containment limits the damage when it happens anyway.
- **Gates, not dates.** Phases advance on green gates (roadmap §2). The two gates that
  block money are: `migration:compare` exiting 0, and `npm run test:all` against the new
  server.
- **Review cadence:** the register is reviewed at the end of every phase, and any risk that
  is *newly* introduced by that phase is added before the next one starts.

Scoring: **L**ikelihood and **I**mpact are H/M/L. Anything H/H must have a rehearsed
containment step before Phase 4.

## 2. Risk register

### R-01 — Money or timestamp corruption during import — H/H

- **Signal:** `migration:compare` FAIL on `aggregate checksum`, `ordered total` or
  `settled total`; `--detail` naming `amount` or `createdAt`.
- **Mitigation:** canonical hashing of 2-decimal money strings and ISO-8601 instants on
  both sides; `to_timestamp(created_at / 1000.0)` mandated in the loader; the epoch-unit
  guard refusing anything below `1e12`.
- **Containment:** the parity gate blocks the flip. Legacy SQLite is unmodified, so rollback
  is a redeploy, not a restore.
- **Owner:** whoever runs the freeze, with a second person reading the parity output.

### R-02 — "Missing rows" that are not data loss — M/M

- **Signal:** `every order id survived (105 of 106)` with one or two ids missing.
- **Cause:** the legacy `sweep()` deletes anything older than two hours on every read *and*
  write, so a row can expire between the two snapshots.
- **Mitigation:** freeze (stop the writer, `--freeze` checkpoint) before snapshotting;
  snapshot both sides inside the same window.
- **Containment:** the harness's failure guidance names this cause first, so nobody pages
  someone about "data loss" that is working-as-designed expiry.

### R-03 — Double settlement, or the replay guard lost in the port — M/H

- **Signal:** a second `verify` call for the same order returning `completed` **without**
  `replay: true`; two rows for one order; `result_amount` changing on an already-settled
  order.
- **Mitigation:** the conditional `UPDATE … WHERE completed_at IS NULL RETURNING` (§3 of the
  data spec) instead of a read-then-write; the replay guard evaluated **before** any amount
  comparison, exactly as today.
- **Detection:** `npm run test:store` cases 2–5 re-run against Next.js; these are the exact
  behaviours they assert.
- **Containment:** settlement is idempotent at the database level, so a duplicate callback
  returns the stored result rather than charging twice.

### R-04 — The gateway callback is rejected because it hit a Server Action — M/H

- **Signal:** eSewa's return navigation renders a CSRF/origin error instead of the
  confirmation page; the callback works from `curl` but not from the gateway.
- **Cause:** React Server Actions reject cross-origin POSTs by design, and eSewa's return
  originates from `epay.esewa.com.np`.
- **Mitigation:** `/payment/callback` is a plain Route Handler exporting `GET` and `POST` —
  never a Server Action, never a page.
- **Containment:** the mock-mode in-page flow still exercises `verify` directly, so the
  payment path is testable even while the redirect path is broken.

### R-05 — Return URLs point at `localhost` after the flip — M/H

- **Signal:** the gateway redirects a phone or an external browser to
  `http://localhost:3000/...`; `test-esewa-sandbox` passes locally but the real device flow
  fails.
- **Cause:** `publicOrigin()` reimplemented from the wrong header, or a proxy rewriting
  `Host`. The legacy Vite config documents this exact hazard with `changeOrigin`.
- **Mitigation:** `PUBLIC_APP_URL` wins when set; otherwise `x-forwarded-host` before
  `host`. **Verify from a second device on the LAN before Phase 4**, not from localhost.
- **Containment:** set `PUBLIC_APP_URL` explicitly, which pins the origin regardless of
  header behaviour.

### R-06 — Breaking dependency changes during the port — M/M

- **Signal:** type errors after a React/Radix/Tailwind upgrade; hydration mismatch warnings;
  a UI primitive behaving differently.
- **Mitigation:** delete the 29 dead UI files and 26 dead dependencies **first**, so
  upgrades touch far less code; re-vendor the surviving primitives from current shadcn/ui
  output rather than patching them; keep the Tailwind major upgrade out of the framework
  migration entirely.
- **Containment:** pin exact versions during the port and upgrade afterwards, one major at a
  time, each behind its own green `test:all`.

### R-07 — Divergence between two writers during transition — L/H

- **Signal:** a row present in one engine and missing from the other; two different
  `result_amount` values for one `order_id`.
- **Note:** this risk is **designed out**, not mitigated — Phases 3 and 4 use
  proxy-then-swap, so there is exactly one ledger and one writer at all times. Dual-write
  was explicitly rejected (roadmap §6.1) because reconciling a two-hour TTL sweep and
  non-unique gateway references would mean reimplementing both behaviours in a new,
  untested place.
- **Containment if dual writes are ever reintroduced:** the parity harness compares the two
  engines directly, so divergence surfaces as a row-count or checksum failure rather than as
  a silent accounting error.

### R-08 — Pool exhaustion, or a pool leaked by HMR — M/M

- **Signal:** requests hanging; `/api/health` reporting `waitingCount > 0`; Postgres
  refusing new connections after a long dev session.
- **Cause:** Next.js dev re-evaluates modules, creating a `Pool` per hot reload; or a slow
  query holding a connection because no `statement_timeout` is set (SQLite's
  `busy_timeout = 5000` has no automatic replacement).
- **Mitigation:** `globalThis`-guarded pool singleton; explicit `max`; per-transaction
  `statement_timeout` and `lock_timeout`.
- **Containment:** dropping `max` to 1–2 restores stability at the cost of throughput, and
  is a better emergency lever than restarting the database.

### R-09 — Performance regression from rendering or query patterns — M/M

- **Signal:** p95 on `/shop` or `/product/[id]` worse than the Vite build; N queries per
  page in the logs; the same query repeated per request (missing cache).
- **Mitigation:** Server Components query the database directly (no self-inflicted HTTP
  hop); the catalogue is cached and tag-revalidated; the callback index is composite and
  partial so the hot lookup stays an index scan.
- **Baseline requirement:** the legacy stack has **no performance baseline** — measure the
  five critical paths (`/`, `/shop`, `/product/[id]`, `initiate`, `verify`) *before*
  Phase 3, or "no regression" cannot be claimed afterwards.

### R-10 — A secret leaks into the client bundle — L/H

- **Signal:** `ESEWA_SECRET_KEY` or `KHALTI_SECRET_KEY` in a client chunk; a `NEXT_PUBLIC_`
  prefix on a server-only variable.
- **Mitigation:** invert the old convention — private by default, `NEXT_PUBLIC_` only for
  genuinely public values (the two `VITE_*` variables: API base, and the Khalti **public**
  key); `import "server-only"` on every module reading a secret; keep
  `assertLiveSecretsPresent()`.
- **Detection:** the existing assertion in `test-api.ts`
  (`!JSON.stringify(body).includes("8gBm")`) plus a CI grep over `.next/static` for the
  secret prefix.

### R-11 — The schema migration is not reversible — L/H

- **Signal:** no tested `down` path; a failed cutover with no way back.
- **Mitigation:** every migration ships with its reverse; apply **and** reverse it on a
  production-sized copy before Phase 4; keep the `pg_dump` taken immediately after the
  import as the fast restore point.
- **Containment:** the legacy SQLite file stays authoritative until Phase 5, so the database
  is not the only route back.

### R-12 — Silent drift in money semantics — M/H

- **Signal:** the charged amount differing from the displayed amount; a one-paisa rounding
  difference; the ±0.01 tolerance hiding a real discrepancy.
- **Mitigation:** the price the shopper sees and the price the server charges must resolve to
  the same row (§6 of the architecture doc); `numeric(12,2)` in the database; explicit
  conversion only at the API boundary, never inside a query.
- **Detection:** `test-currency.ts` for display maths, `test-api.ts` for the charging path,
  the parity harness for the stored value.

### R-13 — Losing the "back it up as a unit" safety net — M/H

- **Signal:** no restore has ever been performed from a Postgres backup.
- **Cause:** SQLite's operational simplicity was that the whole database is one file, and that
  property is being traded away deliberately.
- **Mitigation:** nightly `pg_dump` plus continuous WAL archiving / point-in-time recovery,
  **and one rehearsed restore** before Phase 5 completes. A backup nobody has restored from
  is not a backup.

### R-14 — A new constraint rejects legitimate legacy rows — M/M

- **Signal:** the import failing on `orders_completion_consistent`; a row with
  `completed_at` set while `result_status` is null.
- **Mitigation:** add the check `NOT VALID`, import, audit
  (`SELECT order_id FROM orders WHERE (completed_at IS NULL) <> (result_status IS NULL);`),
  then `VALIDATE CONSTRAINT`. Never let a new constraint be the thing that discovers a data
  problem mid-freeze.

## 3. QA layers

| Layer | Tooling | Covers | Gate |
| --- | --- | --- | --- |
| Static | `tsc --noEmit`, `eslint`, `no-restricted-imports` bans | Type drift, reintroduced deprecations, dead code | Every PR |
| Unit | `test-currency.ts` | Rounding, VAT, shipping thresholds | Every PR |
| Contract | `test-api.ts`, `test-inpage.ts` via `BASE=http://localhost:3000` | JSON shape, signature validity, amount comparison, replay, secret non-disclosure | Every PR |
| Persistence | `test-store.ts` (ported to a throwaway Postgres schema) | Durability, single-row retries, replay, forged-payload immunity | Every PR |
| Data parity | `migration:compare` | Every byte of the ledger, both engines | Pre-cutover, on staging, twice |
| Live gateway | `test-esewa-sandbox` (`sandbox` mode) | The real eSewa host and a real signature | Before and after Phase 4 |
| Manual / E2E | LAN device walkthrough | Return-URL host correctness — the one thing localhost tests cannot prove | Before and after Phase 4 |
| Performance | Baseline before Phase 3, re-measure after | p95 on the five critical paths | Phase 4 |

### What each existing suite buys the migration

- **`test-api.ts`** — signed initiate, valid verify, replay, and the assertion that the
  secret never appears in a response. Repointed at the new server, it becomes a regression
  test for the port itself.
- **`test-inpage.ts`** — the in-page mock flow end to end; the only path that exercises
  `simulated-gateway.ts` rebuilding a callback the wallet would have sent.
- **`test-store.ts`** — the five persistence properties. The most valuable suite here,
  because each one is something a port can silently lose.
- **`test-currency.ts`** — pure maths, untouched by the migration, and therefore a cheap
  canary that shared code was not disturbed.
- **`test-esewa-sandbox.ts`** — the only test proving the signature still works against a
  real gateway host.

## 4. Cutover go/no-go checklist

Every line must be true before the freeze starts. Any "no" is a delay, not a judgement call.

- [ ] `migration:compare` exited 0 on staging, twice, on two different snapshots.
- [ ] `npm run test:all` green against the Next.js server for three consecutive runs.
- [ ] Schema migration applied to a production-sized copy, and its `down` path tested.
- [ ] Rollback rehearsed twice, with a measured time recorded.
- [ ] Maintenance-mode page reachable; payment routes return 503.
- [ ] `pg_dump` procedure executed once end-to-end, including a test restore.
- [ ] Return-URL host verified from a second device on the LAN.
- [ ] eSewa sandbox flow completed through the new callback handler.
- [ ] Two named people present: one executing, one verifying parity output.
- [ ] Performance baseline captured for the five critical paths.

## 5. First 24 hours after cutover

| When | Check |
| --- | --- |
| +5 min | `/api/health`: pool counts sane, `paymentsMode` correct, row count matches the import |
| +15 min | One real mock-mode payment end to end, including the confirmation page |
| +1 h | Zero `5xx` on payment routes; no duplicate `order_id`; replay guard observed at least once |
| +2 h | Rows crossing the two-hour boundary behave correctly under the new retention policy (both a scheduled delete and the gateway `expires_at` window) |
| +4 h | Re-run `migration:compare` against a fresh snapshot — a *post*-migration parity check catches a loader bug that only manifests on the second write |
| +24 h | First nightly `pg_dump` completes; confirm row count and that a restore into a scratch database succeeds |

## 6. What "done" means

The migration is complete when all of the following are true, and not before:

1. `npm ls` reports none of `express`, `cors`, `better-sqlite3`, `vite`, `react-router-dom`.
2. A fresh clone installs, builds and runs with **one** process and **one** database.
3. `npm run test:all` and `migration:compare` are green in CI on every pull request.
4. The parity harness has passed in the production environment, not only on staging.
5. A restore from a Postgres backup has been performed successfully at least once.
6. `docs/migration/*` reflects the stack as it actually is — including any decision this
   roadmap got wrong, corrected in place rather than in a newer document.