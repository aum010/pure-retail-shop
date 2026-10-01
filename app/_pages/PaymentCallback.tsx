"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Clock, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/lib/store';
import { formatNPR } from '@/lib/currency';
import { clearStashedOrder, readStashedOrder } from '@/lib/paymentOrder';
import {
  callbackParams,
  checkEsewaStatus,
  isPaymentProvider,
  paymentProviders,
  verifyPayment,
  type PaymentProvider,
  type VerifyResponse,
} from '@/lib/payments';

/**
 * The route both wallets send the shopper back to.
 *
 * Nothing on this page is trusted. The query string is whatever the browser was
 * pointed at with — a shopper can type it by hand — so it is forwarded to the
 * API untouched and the *server* decides what happened, by re-deriving the
 * signature it issued and (for eSewa) by asking the gateway's own status
 * endpoint. This component only ever renders that verdict.
 *
 * The cart is cleared after the verdict says `completed`, never before, so a
 * declined or cancelled payment leaves the basket exactly as it was and
 * "Return to checkout" is a real option rather than a consolation prize.
 */
const PaymentCallback = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clearCart = useStore((state) => state.clearCart);
  const setLastOrder = useStore((state) => state.setLastOrder);

  const callback = useMemo(() => callbackParams(searchParams), [searchParams]);
  const stashed = useMemo(() => readStashedOrder(), []);

  // The return URL we register always carries `provider`; a bookmarked or
  // hand-typed callback might not, so fall back to the order that is pending.
  const providerParam = searchParams.get('provider');
  const provider: PaymentProvider | null =
    providerParam && isPaymentProvider(providerParam) ? providerParam : stashed?.provider ?? null;

  const [verifying, setVerifying] = useState(true);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);

  // React 18 runs effects twice in dev. Verifying twice is not merely noisy —
  // the second call would look like a replayed callback to the API.
  const attempted = useRef(false);
  useEffect(() => {
    if (!provider || attempted.current) return;
    attempted.current = true;

    let ignore = false;
    verifyPayment(provider, callback)
      .then((response) => !ignore && setResult(response))
      .catch((cause: unknown) => {
        if (!ignore) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!ignore) setVerifying(false);
      });

    return () => {
      ignore = true;
    };
  }, [provider, callback]);

  // Settle once the server confirms, and only ever once — navigating to
  // /confirmation must not send this effect around again.
  const settled = useRef(false);
  useEffect(() => {
    if (!result || result.status !== 'completed' || settled.current) return;
    settled.current = true;

    clearCart();
    clearStashedOrder();
    setLastOrder({
      orderId: result.orderId ?? stashed?.orderId ?? 'unknown',
      amount: result.amount ?? stashed?.amount ?? 0,
      provider: result.provider ?? provider ?? 'esewa',
      transactionId: result.transactionId ?? '',
      transactionCode: result.transactionCode ?? '',
      placedAt: new Date().toISOString(),
    });
    router.replace('/confirmation');
  }, [result, provider, stashed, clearCart, setLastOrder, router]);

  /**
   * eSewa is the only provider that answers a direct status question, so a
   * pending payment can be chased instead of left in limbo.
   */
  const recheck = async () => {
    setRechecking(true);
    setError(null);
    try {
      const response = await checkEsewaStatus({
        orderId: callback.orderId ?? stashed?.orderId,
        transactionUuid: callback.transaction_uuid ?? stashed?.gatewayRef,
      });
      setResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRechecking(false);
    }
  };

  const label = provider ? paymentProviders[provider].label : 'the wallet';
  const amount = result?.amount ?? stashed?.amount;

  const Detail = ({ term, value }: { term: string; value: string }) => (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{term}</span>
      <span className="font-medium break-all text-right">{value}</span>
    </div>
  );

  const Shell = ({
    icon,
    title,
    tone,
    children,
  }: {
    icon: React.ReactNode;
    title: string;
    tone: string;
    children: React.ReactNode;
  }) => (
    <div className="min-h-screen py-16">
      <div className="container-custom max-w-xl">
        <Card className="p-8">
          <div className="text-center mb-6">
            <div className={`mx-auto mb-4 w-fit ${tone}`}>{icon}</div>
            <h1 className="text-2xl font-serif mb-2">{title}</h1>
          </div>
          {children}
        </Card>
      </div>
    </div>
  );

  if (!provider) {
    return (
      <Shell icon={<AlertTriangle className="h-12 w-12" />} title="We couldn't place this payment" tone="text-destructive">
        <p className="text-sm text-muted-foreground mb-6">
          This page arrived without saying which wallet it came from, so there was nothing to
          verify against. Nothing has been charged and your cart is untouched.
        </p>
        <Button asChild variant="accent" className="w-full">
          <Link href="/cart">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to cart
          </Link>
        </Button>
      </Shell>
    );
  }

  if (verifying || settled.current) {
    return (
      <Shell icon={<Loader2 className="h-12 w-12 animate-spin" />} title="Confirming your payment" tone="text-accent">
        <p className="text-sm text-muted-foreground text-center">
          Asking {label} to confirm the transaction. Please don't close this page.
        </p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell
        icon={<AlertTriangle className="h-12 w-12" />}
        title="We couldn't reach the payment service"
        tone="text-destructive"
      >
        <p className="text-sm text-destructive mb-2">{error}</p>
        <p className="text-sm text-muted-foreground mb-6">
          Your cart is untouched. If {label} has already debited your account the payment will
          still settle once the service is reachable — check your orders before paying again.
        </p>
        <Button asChild variant="accent" className="w-full">
          <Link href="/checkout">Return to checkout</Link>
        </Button>
      </Shell>
    );
  }

  if (result?.status === 'pending') {
    return (
      <Shell icon={<Clock className="h-12 w-12" />} title="Payment is still pending" tone="text-warning">
        <p className="text-sm text-muted-foreground mb-6 text-center">
          {result.message} Your cart is still here, and paying again may charge you twice.
        </p>
        <div className="space-y-2 mb-6">
          <Detail term="Order" value={result.orderId ?? stashed?.orderId ?? '—'} />
          {amount != null && <Detail term="Amount" value={formatNPR(amount)} />}
          {result.gatewayStatus && <Detail term="Gateway status" value={result.gatewayStatus} />}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {provider === 'esewa' && (
            <Button variant="accent" className="flex-1" onClick={recheck} disabled={rechecking}>
              <RefreshCw className={`mr-2 h-4 w-4 ${rechecking ? 'animate-spin' : ''}`} />
              {rechecking ? 'Checking…' : 'Ask eSewa again'}
            </Button>
          )}
          <Button variant="outline" className="flex-1" asChild>
            <Link href="/checkout">Return to checkout</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell icon={<XCircle className="h-12 w-12" />} title="Payment not completed" tone="text-destructive">
      <p className="text-sm text-muted-foreground mb-6 text-center">
        {result?.message ?? `${label} did not complete this payment.`} Your cart is untouched, so
        you can try again another way.
      </p>

      <div className="space-y-2 mb-6">
        <Detail term="Order" value={result?.orderId ?? stashed?.orderId ?? '—'} />
        {amount != null && <Detail term="Amount" value={formatNPR(amount)} />}
        {result?.gatewayStatus && <Detail term="Gateway status" value={result.gatewayStatus} />}
        {result?.source && <Detail term="Confirmed by" value={result.source} />}
        {typeof result?.signatureValid === 'boolean' && (
          <Detail term="Signature" value={result.signatureValid ? 'Valid' : 'Invalid'} />
        )}
        {result?.replay && <Detail term="Replay" value="Already processed" />}
      </div>

      {/* Kept for the one class of bug that is otherwise invisible: a parameter
          we failed to read the way the gateway wrote it. It is just the URL the
          browser is already sitting on, so nothing is being exposed. */}
      <details className="mb-6">
        <summary className="text-xs text-muted-foreground cursor-pointer">
          Parameters {label} returned
        </summary>
        <pre className="mt-2 p-3 bg-muted/40 rounded-md text-xs overflow-x-auto">
          {JSON.stringify(callback, null, 2)}
        </pre>
      </details>

      <Separator className="mb-6" />

      <div className="flex flex-col sm:flex-row gap-3">
        <Button variant="accent" className="flex-1" asChild>
          <Link href="/checkout">Try a different method</Link>
        </Button>
        <Button variant="outline" className="flex-1" asChild>
          <Link href="/shop">Continue shopping</Link>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mt-6 flex items-center justify-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
        Outcome decided by the payment service, not by this page
      </p>
    </Shell>
  );
};

export default PaymentCallback;
