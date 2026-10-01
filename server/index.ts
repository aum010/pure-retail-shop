import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { config, projectRoot, assertLiveSecretsPresent, esewaBaseUrl, khaltiBaseUrl, usesRealEsewa, usesRealKhalti } from "./config.js";
import { buildEsewaInitiate, verifyEsewaCallback, decodeEsewaData, checkEsewaStatus, buildEsewaStatusCheckUrl } from "./esewa.js";
import { initiateKhalti, verifyKhalti } from "./khalti.js";
import {
  createOrder,
  resolveOrderForCallback,
  markCompleted,
  getOrder,
  databasePath,
  countOrders,
} from "./orderStore.js";
import { formatNpr, MAX_ORDER_AMOUNT } from "./money.js";

assertLiveSecretsPresent();

const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

/** Rejects non-positive, non-finite, or implausibly large NPR amounts. */
function parseAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ORDER_AMOUNT) {
    throw Object.assign(new Error("A valid positive amount is required."), { status: 400 });
  }
  return Math.round(amount * 100) / 100;
}

function parseOrderId(value: unknown) {
  const orderId = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(orderId)) {
    throw Object.assign(new Error("A valid orderId is required."), { status: 400 });
  }
  return orderId;
}

const asyncRoute =
  (handler: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res).catch(next);
  };

/**
 * The origin the shopper actually reached the site on.
 *
 * `PUBLIC_APP_URL` wins when set, so a deployed instance pins its own origin.
 * Otherwise the address the browser used is derived from the request — without
 * this, every gateway return URL would say `localhost:8080`, which is
 * unreachable from a phone on the LAN (and from anywhere once deployed).
 */
function publicOrigin(req: express.Request) {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  // The dev proxy forwards the original Host, since it rewrites its own.
  const forwardedHost = req.get("x-forwarded-host") ?? req.get("host");
  if (forwardedHost) {
    const proto = req.get("x-forwarded-proto") ?? req.protocol;
    return `${proto}://${forwardedHost}`;
  }

  // Browsers send Origin on POSTs, which covers the API being hosted apart
  // from the storefront.
  return req.get("origin")?.replace(/\/+$/, "") ?? config.clientOrigin;
}

/** Builds the absolute URL the gateway redirects back to. */
function callbackUrl(req: express.Request, provider: "esewa" | "khalti") {
  return `${publicOrigin(req)}/payment/callback?provider=${provider}`;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    paymentsMode: config.paymentsMode,
    esewaEnv: config.esewa.env,
    khaltiEnv: config.khalti.env,
    // Reports the store's location, never its contents — it is how an operator
    // confirms which file to back up.
    store: { backend: "sqlite", path: databasePath, rows: countOrders() },
  });
});

// ── eSewa ────────────────────────────────────────────────────────────────

app.post(
  "/api/payments/esewa/initiate",
  asyncRoute(async (req, res) => {
    const orderId = parseOrderId(req.body?.orderId);
    const amount = parseAmount(req.body?.amount);
    const description = String(req.body?.description ?? "Order payment").slice(0, 100);
    const customer = {
      name: String(req.body?.customer?.name ?? "").slice(0, 100),
      email: String(req.body?.customer?.email ?? "").slice(0, 200),
      phone: req.body?.customer?.phone ? String(req.body.customer.phone).slice(0, 40) : undefined,
    };

    const order = {
      orderId,
      provider: "esewa" as const,
      amount,
      description,
      customer,
      gatewayRef: "",
    };

    const result = buildEsewaInitiate({
      order,
      successUrl: callbackUrl(req, "esewa"),
      failureUrl: callbackUrl(req, "esewa"),
    });

    // Remember the charged amount so verify never trusts the client.
    createOrder({ ...order, gatewayRef: result.transactionUuid });

    res.json({
      provider: "esewa",
      mode: result.mode,
      action: result.action,
      method: result.method,
      fields: result.fields,
      orderId,
      amount,
      transactionUuid: result.transactionUuid,
    });
  })
);

app.post(
  "/api/payments/esewa/verify",
  asyncRoute(async (req, res) => {
    const orderId = req.body?.orderId ? String(req.body.orderId) : undefined;
    const encoded = req.body?.data ? String(req.body.data) : undefined;

    let order = resolveOrderForCallback(orderId, undefined);

    // eSewa's callback omits our order id, so recover it from the payload.
    if (!order && encoded) {
      try {
        const payload = decodeEsewaData(encoded);
        order = resolveOrderForCallback(undefined, payload.transaction_uuid);
      } catch {
        order = null;
      }
    }

    if (!order) {
      return res.status(404).json({
        ok: false,
        status: "failed",
        message: "No matching order was found for this payment. It may have expired.",
      });
    }

    if (order.completedAt) {
      return res.json({
        ok: true,
        status: "completed",
        message: "This payment was already verified.",
        orderId: order.orderId,
        amount: order.result?.amount ?? order.amount,
        transactionId: order.result?.transactionId,
        transactionCode: order.result?.transactionCode,
        replay: true,
      });
    }

    // A failure redirect carries an error code and no payload.
    if (!encoded) {
      const code = String(req.body?.errorCode ?? "unknown");
      return res.status(200).json({
        ok: true,
        status: "failed",
        gatewayStatus: code.toUpperCase(),
        message: `eSewa reported an error while processing the payment (${code}).`,
        orderId: order.orderId,
        amount: order.amount,
      });
    }

    const verification = verifyEsewaCallback(encoded, order.amount);

    // Amount must match what the server charged.
    if (Math.abs(verification.amount - order.amount) > 0.01 && verification.status === "completed") {
      verification.status = "failed";
      verification.message = `eSewa reported ${formatNpr(verification.amount)} but the order was for ${formatNpr(order.amount)}.`;
    }

    if (verification.status === "completed") {
      markCompleted(order.orderId, {
        status: "completed",
        transactionId: verification.transactionId,
        transactionCode: verification.transactionCode,
        amount: order.amount,
      });
    }

    res.json({
      ok: true,
      provider: "esewa",
      status: verification.status,
      gatewayStatus: verification.gatewayStatus,
      message: verification.message,
      signatureValid: verification.signatureValid,
      orderId: order.orderId,
      amount: order.amount,
      transactionId: verification.transactionId,
      transactionCode: verification.transactionCode,
      source: verification.source,
    });
  })
);

/** Server-side status check for orders where no callback arrived. */
app.post(
  "/api/payments/esewa/status",
  asyncRoute(async (req, res) => {
    const order = resolveOrderForCallback(
      req.body?.orderId ? String(req.body.orderId) : undefined,
      req.body?.transactionUuid ? String(req.body.transactionUuid) : undefined
    );
    if (!order) return res.status(404).json({ ok: false, message: "Order not found." });

    const transactionUuid = String(req.body?.transactionUuid ?? order.gatewayRef);
    const statusCheckUrl = buildEsewaStatusCheckUrl({ transactionUuid, totalAmount: order.amount });

    if (!usesRealEsewa) {
      return res.json({
        ok: true,
        provider: "esewa",
        status: order.completedAt ? "completed" : "pending",
        gatewayStatus: order.completedAt ? "COMPLETE" : "PENDING",
        message: `Mock status check for ${transactionUuid}.`,
        orderId: order.orderId,
        amount: order.amount,
        transactionId: transactionUuid,
        statusCheckUrl,
        source: "status-check",
      });
    }

    const result = await checkEsewaStatus({ transactionUuid, totalAmount: order.amount });
    const status =
      result.status === "COMPLETE" ? "completed" : result.status === "PENDING" ? "pending" : "failed";

    if (status === "completed" && !order.completedAt) {
      markCompleted(order.orderId, { status, transactionId: transactionUuid, amount: order.amount });
    }

    res.json({
      ok: true,
      provider: "esewa",
      status,
      gatewayStatus: result.status,
      message: `eSewa status check returned ${result.status}.`,
      orderId: order.orderId,
      amount: order.amount,
      transactionId: transactionUuid,
      refId: result.ref_id,
      statusCheckUrl,
      source: "status-check",
    });
  })
);

// ── Khalti ───────────────────────────────────────────────────────────────

app.post(
  "/api/payments/khalti/initiate",
  asyncRoute(async (req, res) => {
    const orderId = parseOrderId(req.body?.orderId);
    const amount = parseAmount(req.body?.amount);
    const description = String(req.body?.description ?? "Order payment").slice(0, 100);
    const customer = {
      name: String(req.body?.customer?.name ?? "").slice(0, 100),
      email: String(req.body?.customer?.email ?? "").slice(0, 200),
      phone: req.body?.customer?.phone ? String(req.body.customer.phone).slice(0, 40) : undefined,
    };

    const order = {
      orderId,
      provider: "khalti" as const,
      amount,
      description,
      customer,
      gatewayRef: "",
    };

    const result = await initiateKhalti({
      order,
      returnUrl: callbackUrl(req, "khalti"),
      websiteUrl: publicOrigin(req),
    });

    createOrder({ ...order, gatewayRef: result.pidx });

    res.json({
      provider: "khalti",
      mode: result.mode,
      pidx: result.pidx,
      redirectUrl: result.redirectUrl,
      orderId,
      amount,
      amountPaisa: result.amountPaisa,
    });
  })
);

app.post(
  "/api/payments/khalti/verify",
  asyncRoute(async (req, res) => {
    const pidx = req.body?.pidx ? String(req.body.pidx) : undefined;
    const orderId = req.body?.orderId ? String(req.body.orderId) : undefined;
    const callbackStatus = req.body?.status ? String(req.body.status) : undefined;

    // The pidx is client-supplied, so it is only used to find a stored order;
    // the amount compared against always comes from the server's record.
    const order = resolveOrderForCallback(orderId, pidx);

    if (!order) {
      return res.status(404).json({
        ok: false,
        status: "failed",
        message: "No matching order was found for this payment. It may have expired.",
      });
    }

    if (order.completedAt) {
      return res.json({
        ok: true,
        status: "completed",
        message: "This payment was already verified.",
        orderId: order.orderId,
        amount: order.result?.amount ?? order.amount,
        transactionId: order.result?.transactionId,
        replay: true,
      });
    }

    const verification = await verifyKhalti({
      pidx: pidx ?? order.gatewayRef,
      expectedAmount: order.amount,
      callbackStatus,
    });

    if (verification.status === "completed") {
      markCompleted(order.orderId, {
        status: "completed",
        transactionId: verification.transactionId,
        amount: order.amount,
      });
    }

    res.json({
      ok: true,
      provider: "khalti",
      status: verification.status,
      gatewayStatus: verification.gatewayStatus,
      message: verification.message,
      orderId: order.orderId,
      pidx: verification.pidx,
      amount: order.amount,
      transactionId: verification.transactionId,
      source: verification.source,
    });
  })
);

// ── Introspection & error handling ───────────────────────────────────────

/** Reports which mode each provider is actually running in — never secret values. */
app.get("/api/payments/config", (_req, res) => {
  res.json({
    mode: config.paymentsMode,
    providers: {
      esewa: {
        live: usesRealEsewa,
        env: config.esewa.env,
        host: new URL(esewaBaseUrl).host,
      },
      khalti: {
        live: usesRealKhalti,
        env: config.khalti.env,
        host: new URL(khaltiBaseUrl).host,
      },
    },
  });
});

app.get("/api/orders/:orderId", (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, message: "Order not found." });
  res.json({
    ok: true,
    order: {
      orderId: order.orderId,
      provider: order.provider,
      amount: order.amount,
      status: order.completedAt ? "completed" : "pending",
      transactionId: order.result?.transactionId,
      createdAt: new Date(order.createdAt).toISOString(),
    },
  });
});

app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error.status ?? 500;
  if (status >= 500) console.error("[api]", error);
  res.status(status).json({ ok: false, message: error.message ?? "Unexpected server error." });
});

/** Optionally serves the built SPA for single-process deployments. */
if (config.serveClient) {
  const dist = path.join(projectRoot, "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
}

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (payments=${config.paymentsMode})`);
  console.log(`[api] orders stored in ${databasePath}`);
});

export { app };

