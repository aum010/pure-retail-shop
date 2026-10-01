/**
 * eSewa display metadata.
 *
 * Request construction and signature generation now live in the Express
 * server (`server/esewa.ts`) so the secret key never reaches the browser.
 * The gateway URLs and test hints remain here for display purposes only.
 */

export const esewaLabel = 'eSewa';

export const esewaGatewayUrl = 'https://rc-epay.esewa.com.np/api/epay/main/v2/form';

export const esewaTestHint =
  'eSewa ID 9711111111 (also 9711111112/3) · Password Test@123 · MPIN 1122 · product code EPAYTEST';


/** Statuses eSewa can report, and how the storefront treats each. */
export function classifyEsewaStatus(status: string): 'completed' | 'pending' | 'failed' {
  const normalized = status.toUpperCase();
  if (normalized === 'COMPLETE') return 'completed';
  if (['FULL_REFUND', 'PARTIAL_REFUND', 'CANCELED', 'NOT_FOUND'].includes(normalized)) return 'failed';
  return 'pending';
}
