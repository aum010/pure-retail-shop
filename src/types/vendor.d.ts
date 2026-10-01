/**
 * Ambient declarations for untyped modules.
 *
 * The Vite setup supplied these through `src/vite-env.d.ts`; the Next setup has
 * no equivalent, so they live here. Each one is deliberately narrow — only the
 * surface this app actually calls — because a vague `any` declaration would
 * hide real mistakes at the call sites.
 */

/** Confetti burst; the app only ever calls the default export once per success. */
declare module "canvas-confetti" {
  interface Vector3 {
    x?: number;
    y?: number;
    z?: number;
  }

  interface ConfettiOptions {
    particleCount?: number;
    angle?: number;
    spread?: number;
    startVelocity?: number;
    decay?: number;
    gravity?: number;
    drift?: number;
    ticks?: number;
    origin?: Vector3;
    colors?: string[];
    shapes?: ("square" | "circle" | "star" | string)[];
    scalar?: number;
    zIndex?: number;
    disableForReducedMotion?: boolean;
  }

  interface Confetti {
    (options?: ConfettiOptions): Promise<null> | null;
    reset(): void;
  }

  const confetti: Confetti;
  export default confetti;
}

/**
 * Khalti's browser SDK. It is only ever reached through the dynamic `import()`
 * in `src/lib/payments/khalti-widget.ts`, which casts the export to its own
 * constructor type — so the app needs the module to resolve, not to be typed.
 */
declare module "khalti-checkout-web" {
  const KhaltiCheckout: unknown;
  export default KhaltiCheckout;
}