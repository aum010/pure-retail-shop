/**
 * Payment server configuration.
 *
 * Server-only. Do not import from client components: this module exposes secret
 * handling, gateway defaults, and runtime flags.
 */
import "server-only";

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return /^(1|true|yes)$/i.test(value.trim());
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000",
  paymentsMode: (process.env.PAYMENTS_MODE ?? "mock") as "mock" | "sandbox" | "live",
  serveClient: parseBoolean(process.env.SERVE_CLIENT, false),
  maintenanceMode: parseBoolean(process.env.MAINTENANCE_MODE, false),
  databaseUrl: process.env.DATABASE_URL ?? "",
  esewa: {
    env: (process.env.ESEWA_ENV ?? "test") as "test" | "production",
    merchantId: process.env.ESEWA_MERCHANT_ID ?? "EPAYTEST",
    productCode: process.env.ESEWA_PRODUCT_CODE ?? "EPAYTEST",
    secretKey: process.env.ESEWA_SECRET_KEY ?? "8gBm/:&EnhH.1/q",
    hasConfiguredSecret: Boolean(process.env.ESEWA_SECRET_KEY),
  },
  khalti: {
    env: (process.env.KHALTI_ENV ?? "sandbox") as "sandbox" | "production",
    secretKey: process.env.KHALTI_SECRET_KEY ?? "",
    hasConfiguredSecret: Boolean(process.env.KHALTI_SECRET_KEY),
  },
} as const;

export const usesRealEsewa = config.paymentsMode !== "mock";
export const usesRealKhalti =
  config.paymentsMode !== "mock" &&
  (config.khalti.hasConfiguredSecret || config.paymentsMode === "live");

export const esewaBaseUrl =
  config.esewa.env === "production" ? "https://epay.esewa.com.np" : "https://rc-epay.esewa.com.np";
export const khaltiBaseUrl =
  config.khalti.env === "production" ? "https://khalti.com" : "https://dev.khalti.com";

export function assertLiveSecretsPresent() {
  if (config.paymentsMode !== "live") return;
  const problems: string[] = [];
  if (config.esewa.env !== "production") {
    problems.push(`ESEWA_ENV=production (currently ${config.esewa.env})`);
  }
  if (!config.esewa.hasConfiguredSecret) problems.push("ESEWA_SECRET_KEY");
  if (config.khalti.env !== "production") {
    problems.push(`KHALTI_ENV=production (currently ${config.khalti.env})`);
  }
  if (!config.khalti.hasConfiguredSecret) problems.push("KHALTI_SECRET_KEY");
  if (problems.length) {
    throw new Error(
      `PAYMENTS_MODE=live but these are unset or still pointed at a sandbox: ${problems.join(
        ", "
      )}. Refusing to start so test credentials can never process a real payment.`
    );
  }
}
