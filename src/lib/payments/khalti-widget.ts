/**
 * In-page Khalti checkout.
 *
 * Khalti ships an official browser SDK (`khalti-checkout-web`) that overlays a
 * full-screen iframe on the merchant's own page, so the shopper never leaves
 * the site. It authenticates with the merchant's *public* key, which is safe to
 * embed; the result still has to be verified server-side with the secret key
 * before an order is treated as paid.
 *
 * The SDK is loaded lazily so it only costs anything when the shopper actually
 * chooses Khalti.
 */

export interface KhaltiWidgetPayload {
  pidx?: string;
  amount?: number;
  transaction_id?: string;
  status?: string;
  mobile?: string;
  [key: string]: unknown;
}

export interface KhaltiWidgetConfig {
  publicKey: string;
  productIdentity: string;
  productName: string;
  productUrl: string;
  amount: number;
  eventHandler: {
    onSuccess: (payload: KhaltiWidgetPayload) => void;
    onError: (error: unknown) => void;
    onClose?: () => void;
  };
  paymentPreference?: string[];
}

interface KhaltiCheckoutInstance {
  show: (updates?: { amount?: number }) => void;
  hide: () => void;
}

type KhaltiCheckoutCtor = new (config: KhaltiWidgetConfig) => KhaltiCheckoutInstance;

/** Present only when a public key has been configured. */
export const khaltiPublicKey = process.env.NEXT_PUBLIC_KHALTI_PUBLIC_KEY ?? '';

/** True when the in-page widget can be used. */
export const isKhaltiWidgetConfigured = Boolean(khaltiPublicKey);

let sdkPromise: Promise<KhaltiCheckoutCtor> | null = null;

async function loadSdk(): Promise<KhaltiCheckoutCtor> {
  if (!sdkPromise) {
    sdkPromise = import('khalti-checkout-web').then((module) => {
      const ctor = (module.default ?? module) as unknown as KhaltiCheckoutCtor;
      if (typeof ctor !== 'function') {
        throw new Error('Khalti checkout SDK did not export a constructor.');
      }
      return ctor;
    });
  }
  return sdkPromise;
}

export interface OpenKhaltiWidgetOptions {
  orderId: string;
  productName: string;
  /** Amount in paisa, which is what the widget expects. */
  amountPaisa: number;
  onSuccess: (payload: KhaltiWidgetPayload) => void;
  onError: (error: unknown) => void;
  onClose?: () => void;
}

/**
 * Opens the in-page checkout overlay. Throws if no public key is configured, so
 * the caller can fall back to the redirect flow.
 */
export async function openKhaltiWidget(options: OpenKhaltiWidgetOptions) {
  if (!khaltiPublicKey) {
    throw new Error(
      'Khalti in-page checkout needs NEXT_PUBLIC_KHALTI_PUBLIC_KEY. See .env.example.'
    );
  }

  const KhaltiCheckout = await loadSdk();

  const checkout = new KhaltiCheckout({
    publicKey: khaltiPublicKey,
    productIdentity: options.orderId,
    productName: options.productName,
    productUrl: window.location.href,
    amount: options.amountPaisa,
    eventHandler: {
      onSuccess: options.onSuccess,
      onError: options.onError,
      onClose: options.onClose,
    },
  });

  checkout.show({ amount: options.amountPaisa });
  return checkout;
}
