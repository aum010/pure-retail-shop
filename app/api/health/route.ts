import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config, esewaBaseUrl, khaltiBaseUrl, usesRealEsewa, usesRealKhalti } from "@/server/config";
import { countOrders, describeStore } from "@/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health is read-only *with one exception*: the legacy SQLite store swept
 * expired rows on every read, and the Postgres store sweeps from here instead —
 * a single explicit DELETE on the health interval rather than a write on every
 * hot path. Set `PAYMENTS_MODE`/`MAINTENANCE_MODE` per environment; in
 * maintenance mode the delete is skipped.
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    ok: true,
    paymentsMode: config.paymentsMode,
    esewaEnv: config.esewa.env,
    khaltiEnv: config.khalti.env,
    store: { ...describeStore(), rows: await countOrders() },
    providers: {
      esewa: { live: usesRealEsewa, env: config.esewa.env, host: new URL(esewaBaseUrl).host },
      khalti: { live: usesRealKhalti, env: config.khalti.env, host: new URL(khaltiBaseUrl).host },
    },
  });
}
