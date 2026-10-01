/**
 * Shared plumbing for the payment Route Handlers.
 *
 * This is the port of three pieces of Express machinery from `server/index.ts`:
 *
 *   `asyncRoute()`      -> `apiHandler()` below; a rejection becomes a JSON error
 *   the error middleware -> `jsonError()`; `status ?? 500`, `{ ok:false, message }`
 *   `parseAmount` /     -> unchanged semantics: the server validates and rounds
 *   `parseOrderId()`      the amount, and refuses order ids that are not safe
 *
 * Keeping them in one file is what keeps every handler readable as a straight
 * transcription of its Express predecessor.
 */
import "server-only";

import { NextResponse } from "next/server";
import { MAX_ORDER_AMOUNT } from "@/server/money";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const notFound = (message: string) => new ApiError(404, message);

/** Rejects non-positive, non-finite, or implausibly large NPR amounts. */
export function parseAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ORDER_AMOUNT) {
    throw badRequest("A valid positive amount is required.");
  }
  return Math.round(amount * 100) / 100;
}

export function parseOrderId(value: unknown): string {
  const orderId = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(orderId)) {
    throw badRequest("A valid orderId is required.");
  }
  return orderId;
}

/** The Express error middleware, as a function: status, body, logging. */
export function jsonError(error: unknown): NextResponse {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  if (status >= 500) console.error("[api]", error);
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * Runs a handler and converts any rejection into the standard error response,
 * so no route has to carry a try/catch for that one job.
 */
export function apiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return jsonError(error);
    }
  };
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Reads a JSON body without letting malformed input become a 500. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Reads and truncates the customer block exactly as the Express handlers did:
 * the legacy code sliced every field to a fixed length before storing it, and
 * those limits are part of the contract with the database.
 */
export function readCustomer(body: Record<string, unknown>): {
  name: string;
  email: string;
  phone?: string;
} {
  const raw = body.customer;
  const customer = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    name: String(customer.name ?? "").slice(0, 100),
    email: String(customer.email ?? "").slice(0, 200),
    ...(customer.phone ? { phone: String(customer.phone).slice(0, 40) } : {}),
  };
}
