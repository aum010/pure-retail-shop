/**
 * eSewa in-app hand-off.
 *
 * eSewa has no browser SDK or embeddable web widget — its only web path is a
 * full redirect to uat.esewa.com.np (the "ePay" flow), where the shopper
 * authenticates on eSewa's own site. The one way to make that feel in-app is to
 * hand off to the installed eSewa Android/iOS app via a deep link on mobile,
 * which is what eSewa's own "Intent" product is built around.
 *
 * This is a best-effort convenience: the redirect remains the fallback and the
 * only option on desktop, where no wallet app exists.
 */

const ANDROID_PACKAGE = 'com.f1soft.esewa';

/** Opens the eSewa app if installed; resolves to false otherwise. */
export function openEsewaApp(): boolean {
  if (typeof window === 'undefined') return false;

  // Deep links only work on real devices. Desktop browsers would either
  // silently fail or prompt for an unknown protocol handler.
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) return false;

  try {
    // Assigning to location is the only reliable way to trigger a custom scheme.
    window.location.href = 'esewa://';
    return true;
  } catch {
    return false;
  }
}

/** Play Store listing, shown when the app is not installed. */
export const ESEWA_ANDROID_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
