"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, Info, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatNPR } from '@/lib/currency';
import {
  buildSimulatedCallback,
  initiatePayment,
  paymentProviders,
  SIMULATED_OUTCOMES,
  type InitiateResponse,
  type PaymentProvider,
} from '@/lib/payments';
import type { SimulatedOutcome } from '@/lib/payments/simulated-gateway';

/**
 * A wallet page for when there is no wallet to redirect to.
 *
 * Checkout settles simulated payments on its own page and reaches the real
 * gateways directly in `sandbox`/`live`, so this route is not part of either
 * path. It is the harness for the redirect itself: it initiates a payment,
 * then sends the browser to `/payment/callback` carrying exactly the parameters
 * eSewa or Khalti would have put there. The callback route, the API, the
 * signature check and the replay guard all run for real — which is the only way
 * to test that a shopper arriving at that URL from *outside* the app still gets
 * the right answer.
 *
 * Open it by hand:
 *   /pay/esewa?amount=2500&orderId=ORD-1&description=Test order
 */
const MockGateway = ({ provider }: { provider: PaymentProvider }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [request, setRequest] = useState<InitiateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<SimulatedOutcome | null>(null);

  const order = useMemo(() => {
    const stashedAmount = Number(searchParams.get('amount'));
    return {
      orderId: searchParams.get('orderId') ?? `ORD-${Date.now().toString().slice(-8)}`,
      amount: Number.isFinite(stashedAmount) && stashedAmount > 0 ? stashedAmount : 2500,
      description: searchParams.get('description') ?? 'Pure Retail order',
      customer: {
        name: searchParams.get('name') ?? 'Test Shopper',
        email: searchParams.get('email') ?? 'test@example.com',
        phone: searchParams.get('phone') ?? '9800000000',
      },
    };
  }, [searchParams]);

  // The same call a real checkout makes, so the fields on screen are the fields
  // the server actually signed.
  useEffect(() => {
    let ignore = false;
    setRequest(null);
    setError(null);

    initiatePayment(provider, order)
      .then((response) => !ignore && setRequest(response))
      .catch((cause: unknown) => {
        if (!ignore) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      ignore = true;
    };
  }, [provider, order]);

  /**
   * Handing over the keys: build the parameters this gateway would have
   * appended and navigate to the real callback route with them.
   */
  const send = (outcome: SimulatedOutcome) => {
    if (!request) return;
    setSending(outcome);

    const query = new URLSearchParams({
      ...buildSimulatedCallback(provider, request, outcome),
      provider,
    });
    router.push(`/payment/callback?${query.toString()}`);
  };

  const info = paymentProviders[provider];

  return (
    <div className="min-h-screen py-12 bg-muted/20">
      <div className="container-custom max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Wallet className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-serif leading-tight">{info.label}</h1>
            <p className="text-xs text-muted-foreground">
              Stand-in for <span className="font-mono">{info.gatewayUrl}</span>
            </p>
          </div>
        </div>

        <Card className="p-6">
          {error ? (
            <>
              <div className="flex items-start gap-3 text-destructive mb-4">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Couldn&apos;t start the payment</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
              </div>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/checkout">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to checkout
                </Link>
              </Button>
            </>
          ) : !request ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
              Requesting a signed payment from the API…
            </div>
          ) : (
            <>
              <div className="space-y-2 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Order</span>
                  <span className="font-medium">{order.orderId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-medium truncate max-w-[60%]">{order.description}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold text-lg">{formatNPR(request.amount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">API mode</span>
                  <span className="font-medium">{request.mode}</span>
                </div>
              </div>

              <Button
                size="lg"
                variant="accent"
                className="w-full"
                disabled={sending !== null}
                onClick={() => send('success')}
              >
                {sending === 'success' ? 'Sending…' : `Pay ${formatNPR(request.amount)}`}
                {sending !== 'success' && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>

              <Separator className="my-5" />

              <p className="text-xs text-muted-foreground mb-3 text-center">
                Return the callback {info.label} would have sent
              </p>
              <div className="grid grid-cols-3 gap-2">
                {SIMULATED_OUTCOMES.map((outcome) => (
                  <Button
                    key={outcome.value}
                    size="sm"
                    variant="outline"
                    title={outcome.hint}
                    disabled={sending !== null}
                    onClick={() => send(outcome.value)}
                  >
                    {outcome.label}
                  </Button>
                ))}
              </div>

              <details className="mt-5">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  What the API issued
                </summary>
                <pre className="mt-2 p-3 bg-muted/40 rounded-md text-xs overflow-x-auto">
                  {JSON.stringify(
                    { pidx: request.pidx, transactionUuid: request.transactionUuid, fields: request.fields },
                    null,
                    2
                  )}
                </pre>
              </details>
            </>
          )}
        </Card>

        <p className="text-xs text-muted-foreground mt-6 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Every button here only decides <em>which</em> callback the browser receives; the verdict
          is still reached by <span className="font-mono">/payment/callback</span> and the API —
          signature check, replay guard and all. Note that a locally built callback does verify,
          because the server re-derives the signature from the fields it issued: that is what makes
          this harness work, and it is why the route should not be exposed in production.
        </p>

        <p className="text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
          No wallet is charged and no credential is collected
        </p>
      </div>
    </div>
  );
};

export default MockGateway;
