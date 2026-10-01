/**
 * Request origin derivation — the Next.js port of `publicOrigin(req)`.
 *
 * The legacy Express `publicOrigin(req)` preferred PUBLIC_APP_URL, then
 * x-forwarded-host, then the Host header. The ordering survives untouched: the
 * return URLs the gateways redirect to must follow the address the shopper
 * actually used, never an internal listen address.
 */
import "server-only";

import { headers } from "next/headers";
import { config } from "@/server/config";

export async function publicOrigin(): Promise<string> {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (forwardedHost) {
    const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
    return `${proto}://${forwardedHost}`;
  }

  return config.clientOrigin;
}

export async function callbackUrl(provider: "esewa" | "khalti"): Promise<string> {
  return `${await publicOrigin()}/payment/callback?provider=${provider}`;
}
