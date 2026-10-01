import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");

const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : /^(1|true|yes)$/i.test(value);

/**
 * `--mode=mock|sandbox|live` on the command line wins over PAYMENTS_MODE, so
 * `npm run dev:sandbox` works without editing .env (and stays cross-platform).
 */
const modeFlag = process.argv
  .find((arg) => arg.startsWith("--mode="))
  ?.slice("--mode=".length);

export const config = {
  port: Number(process.env.PORT ?? 3001),

  /** Where the Vite dev server runs; used to build gateway return URLs. */
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:8080",
  /**
   * How payments are processed:
   *
   *  - "mock"    — nothing leaves the machine; the in-app simulator handles it.
   *  - "sandbox" — calls the real gateway test environments. eSewa works out of
   *                the box using its public EPAYTEST merchant. Khalti sandbox
   *                needs a test secret key from test-admin.khalti.com; without
   *                one it falls back to the simulator.
   *  - "live"    — real money. Requires real secrets (enforced below).
   */
  paymentsMode: (modeFlag ?? process.env.PAYMENTS_MODE ?? "mock") as
    | "mock"
    | "sandbox"
    | "live",
  serveClient: bool(process.env.SERVE_CLIENT, false),
  esewa: {
    /** "test" hits the RC sandbox host; "production" hits the live host. */
    env: (process.env.ESEWA_ENV ?? "test") as "test" | "production",
    merchantId: process.env.ESEWA_MERCHANT_ID ?? "EPAYTEST",
    productCode: process.env.ESEWA_PRODUCT_CODE ?? "EPAYTEST",
    /** Public UAT secret published by eSewa; replaced by a real key when live. */
    secretKey: process.env.ESEWA_SECRET_KEY ?? "8gBm/:&EnhH.1/q",
    /** True when the merchant secret came from the environment. */
    hasConfiguredSecret: Boolean(process.env.ESEWA_SECRET_KEY),
  },
  khalti: {
    secretKey: process.env.KHALTI_SECRET_KEY ?? "",
    hasConfiguredSecret: Boolean(process.env.KHALTI_SECRET_KEY),
    /** Sandbox uses dev.khalti.com; production uses khalti.com. */
    env: (process.env.KHALTI_ENV ?? "sandbox") as "sandbox" | "production",
  },
} as const;

/** eSewa is callable for real whenever we are not purely simulating. */
export const usesRealEsewa = config.paymentsMode !== "mock";

/**
 * Khalti's APIs authenticate with a merchant secret key. The sandbox one has to
 * be issued per-merchant from test-admin.khalti.com, so without it we stay on
 * the simulator even in sandbox mode rather than failing with a 401.
 */
export const usesRealKhalti =
  config.paymentsMode !== "mock" && (config.khalti.hasConfiguredSecret || config.paymentsMode === "live");


/**
 * eSewa hosts.
 *
 * The old UAT host (uat.esewa.com.np) has been decommissioned and no longer
 * resolves. The current test sandbox is the "RC" host, which serves the same
 * ePay v2 API as production and accepts the public EPAYTEST merchant.
 */
export const esewaBaseUrl =
  config.esewa.env === "production" ? "https://epay.esewa.com.np" : "https://rc-epay.esewa.com.np";


export const khaltiBaseUrl =
  config.khalti.env === "production" ? "https://khalti.com" : "https://dev.khalti.com";

/**
 * Fails fast rather than silently charging real cards with sandbox credentials.
 * Only enforced for live mode — sandbox mode is *meant* to use test keys.
 */
export function assertLiveSecretsPresent() {
  if (config.paymentsMode !== "live") return;
  const problems: string[] = [];
  if (config.esewa.env !== "production") {
    problems.push("ESEWA_ENV=production (currently " + config.esewa.env + ")");
  }
  if (!config.esewa.hasConfiguredSecret) problems.push("ESEWA_SECRET_KEY");
  if (config.khalti.env !== "production") {
    problems.push("KHALTI_ENV=production (currently " + config.khalti.env + ")");
  }
  if (!config.khalti.hasConfiguredSecret) problems.push("KHALTI_SECRET_KEY");
  if (problems.length) {
    throw new Error(
      `PAYMENTS_MODE=live but these are unset or still pointed at a sandbox: ` +
        `${problems.join(", ")}. Refusing to start so test credentials can never ` +
        `process a real payment.`
    );
  }
}
