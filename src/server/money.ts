/**
 * Money helpers for the payment server.
 *
 * All amounts crossing the API are Nepali Rupees, matching the storefront and
 * both gateways (eSewa and Khalti settle in NPR, so nothing is converted).
 *
 * Moved from `server/money.ts` in the Next.js migration; the arithmetic is
 * unchanged. Note the one difference the datastore enforces: PostgreSQL stores
 * these amounts as `numeric(12,2)`, so a value that is not exactly two decimal
 * places can no longer exist in the ledger (it could in SQLite's `REAL`).
 */

const formatter = new Intl.NumberFormat('en-NP', {
  style: 'currency',
  currency: 'NPR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats an amount as NPR for user-facing messages, e.g. `NPR 1,250.00`. */
export const formatNpr = (amount: number) => formatter.format(amount);

/**
 * Upper bound for a single order, in rupees. Purely a sanity guard against
 * absurd input; 5,000,000 NPR is far above any realistic basket for this store
 * but still bounded.
 *
 * Mirrored in the database by the `orders_amount_within_limit` check constraint
 * (see drizzle/0000_orders.sql), so the guard survives a bug in this module.
 */
export const MAX_ORDER_AMOUNT = 5_000_000;
