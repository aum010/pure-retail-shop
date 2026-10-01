/**
 * Khalti display metadata.
 *
 * The secret key and the initiate/lookup API calls now live in the Express
 * server (`server/khalti.ts`); the browser only receives a checkout redirect.
 */

export const khaltiLabel = 'Khalti';

export const khaltiGatewayUrl = 'https://dev.khalti.com/api/v2/epayment/initiate/';

export const khaltiTestHint =
  'Khalti ID 9800000000 (also 9800000001–9800000005) · MPIN 1111 · OTP 987654';


/**
 * Per Khalti's docs only "Completed" is a success. "Pending" and "Initiated"
 * must be held, while canceled/expired/refunded transactions have failed.
 */
export function classifyKhaltiStatus(status: string): 'completed' | 'pending' | 'failed' {
  if (status === 'Completed') return 'completed';
  if (['User canceled', 'Expired', 'Failed', 'Refunded'].includes(status)) return 'failed';
  return 'pending';
}
