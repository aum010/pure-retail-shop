import { Suspense } from "react";
import PaymentCallback from "@/app/_pages/PaymentCallback";

/**
 * `/payment/callback` — the eSewa/Khalti redirect target.
 *
 * The page reads the gateway's query string with `useSearchParams()`. On the App
 * Router that hook opts a page out of static rendering, and Next requires a
 * `Suspense` boundary around anything that reads it during the shared render
 * pass — hence the wrapper, which renders nothing until the browser has the URL.
 */
export default function PaymentCallbackRoute() {
  return (
    <Suspense fallback={null}>
      <PaymentCallback />
    </Suspense>
  );
}