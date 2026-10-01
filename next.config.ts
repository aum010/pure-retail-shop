import type { NextConfig } from "next";

/**
 * One origin, one process. The legacy split (Vite on :8080 proxying `/api` to
 * Express on :3001) is why `vite.config.ts` needed `changeOrigin: false` and why
 * the API needed a CORS allow-list — both problems disappear here, because the
 * payment routes are served by the same server that renders the storefront.
 *
 * `serverExternalPackages` keeps `pg` out of the bundle so it loads its native
 * transport at runtime rather than being traced and inlined.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
};

export default nextConfig;
