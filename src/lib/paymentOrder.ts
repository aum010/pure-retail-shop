import type { PaymentProvider } from './payments';

const STORAGE_KEY = 'pure-retail-pending-order';

export interface PendingOrder {
  orderId: string;
  provider: PaymentProvider;
  amount: number;
  description: string;
  /** Khalti pidx or eSewa transaction uuid, as issued by the API. */
  gatewayRef: string;
  /** The signed fields the API returned (eSewa), for display/debugging. */
  request: Record<string, string>;
}

/**
 * The gateway redirect wipes in-memory state, so the order is stashed in
 * sessionStorage and read back on the callback route. The server remains the
 * source of truth for the amount — this is only used for display.
 */
export const stashOrder = (order: PendingOrder) => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(order));
};

export const readStashedOrder = (): PendingOrder | null => {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingOrder;
  } catch {
    return null;
  }
};

export const clearStashedOrder = () => sessionStorage.removeItem(STORAGE_KEY);
