/** Client for the Express payment API. The browser never sees a secret key;
 *  signing and gateway verification both happen server-side. */
import type { PaymentProvider, PaymentStatus } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

export interface InitiateResponse {
  provider: PaymentProvider;
  mode: 'mock' | 'live';
  orderId: string;
  amount: number;
  /** eSewa: the URL + signed fields to POST to. */
  action?: string;
  method?: 'POST' | 'GET';
  fields?: Record<string, string>;
  /** Khalti: where to send the shopper. */
  redirectUrl?: string;
  pidx?: string;
  /** Khalti: the amount the server converted to paisa. */
  amountPaisa?: number;
  transactionUuid?: string;
}

export interface VerifyResponse {
  ok: boolean;
  provider?: PaymentProvider;
  status: PaymentStatus;
  gatewayStatus?: string;
  message: string;
  orderId?: string;
  amount?: number;
  transactionId?: string;
  transactionCode?: string;
  signatureValid?: boolean;
  replay?: boolean;
  source?: string;
}

export interface PaymentMode {
  mode: string;
  providers: Record<
    PaymentProvider,
    { live: boolean; env: string; host: string }
  >;
}

export type PopupOutcome = 'success' | 'pending' | 'failed' | 'canceled';

async function request<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  let payload: VerifyResponse | null = null;
  try {
    payload = (await response.json()) as VerifyResponse;
  } catch {
    // fall through to the status-based error below
  }

  if (!response.ok) {
    throw new Error(payload?.message ?? `Payment request failed (HTTP ${response.status}).`);
  }
  if (!payload) throw new Error('The payment service returned an unreadable response.');

  return payload as T;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  if (!response.ok) {
    throw new Error(`Payment request failed (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

export interface OrderDetails {
  orderId: string;
  amount: number;
  description: string;
  customer: { name: string; email: string; phone?: string };
}

export const initiatePayment = (provider: PaymentProvider, order: OrderDetails) =>
  request<InitiateResponse>(`/payments/${provider}/initiate`, order);

export const verifyPayment = (provider: PaymentProvider, callback: Record<string, string>) =>
  request<VerifyResponse>(`/payments/${provider}/verify`, { provider, ...callback });

export const checkEsewaStatus = (payload: { orderId?: string; transactionUuid?: string }) =>
  request<VerifyResponse>('/payments/esewa/status', payload);

export const fetchPaymentMode = () => get<PaymentMode>('/payments/config');

/** Builds a query object from the URL search params the gateway redirected with. */
export const callbackParams = (params: URLSearchParams) =>
  Object.fromEntries(params.entries());
