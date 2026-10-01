import { apiHandler, json } from "@/server/api";
import { config, esewaBaseUrl, khaltiBaseUrl, usesRealEsewa, usesRealKhalti } from "@/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments/config — which mode each gateway is really in.
 * Never exposes a secret, only the environment and host in use.
 */
export const GET = apiHandler(async (): Promise<Response> => {
  return json({
    mode: config.paymentsMode,
    providers: {
      esewa: { live: usesRealEsewa, env: config.esewa.env, host: new URL(esewaBaseUrl).host },
      khalti: { live: usesRealKhalti, env: config.khalti.env, host: new URL(khaltiBaseUrl).host },
    },
  });
});
