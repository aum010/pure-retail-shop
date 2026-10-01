/**
 * Currency and order totals.
 *
 * All prices in the app are Nepali Rupees. eSewa and Khalti both settle in NPR,
 * so no conversion happens at the payment step — the amount the shopper sees is
 * the amount that is charged.
 */

export const CURRENCY = 'NPR';
export const CURRENCY_CODE = 'NPR';
export const LOCALE = 'en-NP';

const formatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY_CODE,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats an amount as NPR, e.g. `NPR 1,250.00`. */
export const formatNPR = (amount: number) => formatter.format(amount);

/** Formats without the currency prefix, for inputs and compact labels. */
const plainFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const formatAmount = (amount: number) => plainFormatter.format(amount);

/** Nepal's standard VAT rate. */
export const VAT_RATE = 0.13;

/** Flat delivery charge inside Nepal. */
export const SHIPPING_FLAT = 150;

/** Orders at or above this subtotal ship free. */
export const FREE_SHIPPING_THRESHOLD = 5000;

export interface OrderTotals {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  /** How much more is needed to qualify for free delivery. */
  freeShippingGap: number;
}

/**
 * Single source of truth for order maths. Cart and checkout both call this so
 * the figures a shopper sees can never disagree with what is charged.
 */
export function calculateTotals(subtotal: number): OrderTotals {
  const safeSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;
  const shipping = safeSubtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT;
  const tax = round2(safeSubtotal * VAT_RATE);

  return {
    subtotal: round2(safeSubtotal),
    shipping,
    tax,
    total: round2(safeSubtotal + shipping + tax),
    freeShippingGap: Math.max(0, round2(FREE_SHIPPING_THRESHOLD - safeSubtotal)),
  };
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
