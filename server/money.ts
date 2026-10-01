/**
 * Money helpers for the payment server.
 *
 * All amounts crossing the API are Nepali Rupees, matching the storefront and
 * both gateways (eSewa and Khalti settle in NPR, so nothing is converted).
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
 */
export const MAX_ORDER_AMOUNT = 5_000_000;
