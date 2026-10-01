import { Suspense } from "react";
import { notFound } from "next/navigation";
import MockGateway from "@/app/_pages/MockGateway";
import { isPaymentProvider } from "@/lib/payments";

/**
 * `/pay/[provider]` — a hand-driveable wallet page for exercising the redirect
 * flow: it initiates a payment against the API and then sends the browser to
 * `/payment/callback` with the parameters a real gateway would have appended.
 *
 * It is a harness rather than part of checkout (which settles simulated
 * payments in place and reaches the real gateways directly), which is why an
 * unknown provider is a 404 instead of a default to eSewa.
 *
 * `Suspense` because the page reads the transaction details from the query
 * string — same reason as `/payment/callback`.
 */
export default async function MockGatewayRoute({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  if (!isPaymentProvider(provider)) notFound();

  return (
    <Suspense fallback={null}>
      <MockGateway provider={provider} />
    </Suspense>
  );
}